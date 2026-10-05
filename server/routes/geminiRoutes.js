const express = require("express");
const {
  requireAdminRole,
  requireAuthenticatedUser
} = require("../middleware/authSession");

const router = express.Router();
const MAX_DATABASE_ID = 9223372036854775807n;
const MAX_QUESTION_COUNT = 50;
const MODEL_NAME = "gemini-3.6-flash";
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const LANGUAGES = new Set(["en", "hi"]);
const OPTION_KEYS = ["A", "B", "C", "D"];
const QUESTION_FIELDS = [
  "question",
  "options",
  "correctAnswer",
  "explanation",
  "language",
  "difficulty"
];

function databaseId(value) {
  const text = String(value);
  if (
    text.length > 19 ||
    !/^[1-9]\d*$/.test(text) ||
    BigInt(text) > MAX_DATABASE_ID
  ) {
    return null;
  }
  return text;
}

function normalizeChoice(value, allowedValues) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return allowedValues.has(normalized) ? normalized : null;
}

function validateRequest(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "A question generation request is required" };
  }

  const examId = databaseId(body.examId);
  if (!examId) {
    return { error: "examId must be a positive database ID" };
  }

  const sectionId = body.sectionId === undefined
    ? null
    : databaseId(body.sectionId);
  if (body.sectionId !== undefined && !sectionId) {
    return { error: "sectionId must be a positive database ID" };
  }

  const topicId = body.topicId === undefined
    ? null
    : databaseId(body.topicId);
  if (body.topicId !== undefined && !topicId) {
    return { error: "topicId must be a positive database ID" };
  }
  if (!topicId) {
    return { error: "topicId is required to save questions in the question bank" };
  }

  const language = body.language === undefined
    ? "en"
    : normalizeChoice(body.language, LANGUAGES);
  if (!language) {
    return { error: "language must be en or hi" };
  }

  const difficulty = body.difficulty === undefined
    ? null
    : normalizeChoice(body.difficulty, DIFFICULTIES);
  if (body.difficulty !== undefined && !difficulty) {
    return { error: "difficulty must be easy, medium, or hard" };
  }

  const count = body.count === undefined ? 5 : body.count;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_QUESTION_COUNT
  ) {
    return { error: `count must be an integer between 1 and ${MAX_QUESTION_COUNT}` };
  }

  return { value: { examId, sectionId, topicId, language, difficulty, count } };
}

function validateGeneratedQuestions(value, request) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Array.isArray(value.questions) ||
    value.questions.length !== request.count
  ) {
    return null;
  }

  const questions = [];
  for (const question of value.questions) {
    if (
      question === null ||
      typeof question !== "object" ||
      Array.isArray(question) ||
      Object.keys(question).length !== QUESTION_FIELDS.length ||
      QUESTION_FIELDS.some((field) => !Object.hasOwn(question, field)) ||
      typeof question.question !== "string" ||
      question.question.trim().length === 0 ||
      typeof question.explanation !== "string" ||
      question.explanation.trim().length === 0 ||
      question.options === null ||
      typeof question.options !== "object" ||
      Array.isArray(question.options) ||
      Object.keys(question.options).length !== OPTION_KEYS.length ||
      OPTION_KEYS.some((key) =>
        typeof question.options[key] !== "string" ||
        question.options[key].trim().length === 0
      ) ||
      Object.keys(question.options).some((key) => !OPTION_KEYS.includes(key)) ||
      !OPTION_KEYS.includes(question.correctAnswer) ||
      !LANGUAGES.has(question.language) ||
      !DIFFICULTIES.has(question.difficulty) ||
      question.language !== request.language ||
      (request.difficulty !== null && question.difficulty !== request.difficulty)
    ) {
      return null;
    }

    const distinctOptions = new Set(
      OPTION_KEYS.map((key) =>
        question.options[key].trim().replace(/\s+/g, " ").toLocaleLowerCase()
      )
    );
    if (distinctOptions.size !== OPTION_KEYS.length) {
      return null;
    }

    questions.push({
      question: question.question.trim(),
      options: Object.fromEntries(
        OPTION_KEYS.map((key) => [key, question.options[key].trim()])
      ),
      correctAnswer: question.correctAnswer,
      explanation: question.explanation.trim(),
      language: question.language,
      difficulty: question.difficulty
    });
  }

  return questions;
}

class DuplicateQuestionError extends Error {}

async function saveGeneratedQuestions(pool, request, questions, adminId, context) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const requestResult = await client.query(
      `
      INSERT INTO ai_generation_requests
        (user_id, request_type, status, input_data)
      VALUES ($1, 'question_set', 'processing', $2::jsonb)
      RETURNING id
      `,
      [adminId, JSON.stringify(context)]
    );
    const generationRequestId = requestResult.rows[0].id;
    const questionIds = [];

    for (const question of questions) {
      const normalizedQuestion = question.question
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase();
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${request.examId}:${question.language}:${normalizedQuestion}`]
      );
      const duplicateResult = await client.query(
        `
        SELECT q.id
        FROM questions q
        INNER JOIN topics t ON t.id = q.topic_id
        INNER JOIN subjects s ON s.id = t.subject_id
        WHERE s.exam_id = $1
          AND q.language = $2
          AND lower(regexp_replace(btrim(q.question_text), '\\s+', ' ', 'g')) = $3
        LIMIT 1
        `,
        [request.examId, question.language, normalizedQuestion]
      );
      if (duplicateResult.rowCount > 0) {
        throw new DuplicateQuestionError();
      }

      const questionResult = await client.query(
        `
        INSERT INTO questions (
          topic_id, question_text, language, question_type, explanation,
          difficulty, question_origin, ai_generated, review_status,
          is_published, created_by
        )
        VALUES ($1, $2, $3, 'mcq', $4, $5, 'ai_generated', TRUE, 'pending', FALSE, $6)
        RETURNING id
        `,
        [
          request.topicId,
          question.question,
          question.language,
          question.explanation,
          question.difficulty,
          adminId
        ]
      );
      const questionId = questionResult.rows[0].id;
      questionIds.push(questionId);

      for (const key of OPTION_KEYS) {
        await client.query(
          `
          INSERT INTO question_options (question_id, option_key, option_text, is_correct)
          VALUES ($1, $2, $3, $4)
          `,
          [
            questionId,
            key,
            question.options[key],
            question.correctAnswer === key
          ]
        );
      }

      await client.query(
        `
        INSERT INTO ai_question_generations (
          question_id, model_name, prompt_version, generation_status, generated_by
        )
        VALUES ($1, $2, 'structured-question-v1', 'completed', $3)
        `,
        [questionId, MODEL_NAME, adminId]
      );
    }

    await client.query(
      `
      UPDATE ai_generation_requests
      SET status = 'completed',
          output_data = $2::jsonb,
          completed_at = NOW()
      WHERE id = $1
      `,
      [
        generationRequestId,
        JSON.stringify({ questionIds, count: questionIds.length })
      ]
    );
    await client.query("COMMIT");
    transactionStarted = false;
    return { generationRequestId, questionIds };
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
}

// ================================
// Test Gemini connection
// ================================

router.get("/test", async (req, res) => {
  try {
    const genAI = req.app.locals.genAI;

    const model = genAI.getGenerativeModel({
      model: "gemini-3.6-flash"
    });

    const result = await model.generateContent(
      "Reply with exactly: Gemini connection successful"
    );

    const response = result.response.text();

    res.json({
      success: true,
      message: response
    });

  } catch (error) {
    console.error("GEMINI TEST ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Gemini connection failed",
      error: error.message
    });
  }
});

// ================================
// Generate AI Questions
// ================================

router.post(
  "/generate-questions",
  requireAuthenticatedUser,
  requireAdminRole,
  async (req, res) => {
    const validation = validateRequest(req.body);
    if (validation.error) {
      return res.status(400).json({
        success: false,
        message: validation.error
      });
    }

    const request = validation.value;
    const pool = req.app.locals.pool;
    try {
      const examResult = await pool.query(
        `
        SELECT id, name, slug, description
        FROM exams
        WHERE id = $1 AND is_active = TRUE
        `,
        [request.examId]
      );
      if (examResult.rowCount === 0) {
        return res.status(400).json({
          success: false,
          message: "The selected exam is unavailable"
        });
      }

      let section = null;
      if (request.sectionId) {
        const sectionResult = await pool.query(
          `
          SELECT id, name, description
          FROM subjects
          WHERE id = $1 AND exam_id = $2 AND is_active = TRUE
          `,
          [request.sectionId, request.examId]
        );
        if (sectionResult.rowCount === 0) {
          return res.status(400).json({
            success: false,
            message: "The selected section does not belong to this exam"
          });
        }
        section = sectionResult.rows[0];
      }

      let topic = null;
      if (request.topicId) {
        const topicResult = await pool.query(
          `
          SELECT t.id, t.name, t.description, s.id AS section_id,
                 s.name AS section_name, s.description AS section_description
          FROM topics t
          INNER JOIN subjects s ON s.id = t.subject_id
          WHERE t.id = $1
            AND s.exam_id = $2
            AND s.is_active = TRUE
            AND t.is_active = TRUE
            AND ($3::bigint IS NULL OR s.id = $3)
          `,
          [request.topicId, request.examId, request.sectionId]
        );
        if (topicResult.rowCount === 0) {
          return res.status(400).json({
            success: false,
            message: "The selected topic does not belong to this exam and section"
          });
        }
        const topicRow = topicResult.rows[0];
        topic = {
          id: topicRow.id,
          name: topicRow.name,
          description: topicRow.description
        };
        if (!section) {
          section = {
            id: topicRow.section_id,
            name: topicRow.section_name,
            description: topicRow.section_description
          };
        }
      }

      const exam = examResult.rows[0];
      const context = {
        exam: {
          id: exam.id,
          name: exam.name,
          slug: exam.slug,
          description: exam.description
        },
        section,
        topic,
        language: request.language,
        difficulty: request.difficulty || "any of easy, medium, or hard",
        questionCount: request.count
      };
      const prompt = `
You are an expert competitive-exam question setter. Use only the structured exam context below to create exam-relevant questions. Do not invent or change the exam, section, or topic.

Exam context:
${JSON.stringify(context)}

Return exactly one JSON object with this shape and no additional properties or markdown:
{
  "questions": [
    {
      "question": "Question text",
      "options": {
        "A": "First option",
        "B": "Second option",
        "C": "Third option",
        "D": "Fourth option"
      },
      "correctAnswer": "A",
      "explanation": "Explanation in the requested language",
      "language": "${request.language}",
      "difficulty": "easy"
    }
  ]
}

Requirements:
- Return exactly ${request.count} questions.
- Each question has four distinct, non-empty options and exactly one correctAnswer key from A, B, C, or D.
- language must be "${request.language}" for every question; write the question, options, and explanation in that language.
- difficulty must be one of easy, medium, or hard${request.difficulty ? ` and must be "${request.difficulty}"` : ""}.
- Questions must be clear, factually grounded, and suitable for the configured exam context.
- Do not include answers or fields outside the specified JSON structure.
`;

      let generatedData;
      try {
        const genAI = req.app.locals.genAI;
        const model = genAI.getGenerativeModel({
          model: MODEL_NAME,
          generationConfig: {
            responseMimeType: "application/json"
          }
        });
        const result = await model.generateContent(prompt);
        generatedData = JSON.parse(result.response.text());
      } catch {
        console.error("Gemini question generation failed");
        return res.status(502).json({
          success: false,
          message: "Question generation service returned an invalid response"
        });
      }

      const questions = validateGeneratedQuestions(generatedData, request);
      if (!questions) {
        return res.status(502).json({
          success: false,
          message: "Question generation service returned invalid question data"
        });
      }

      let saved;
      try {
        saved = await saveGeneratedQuestions(
          pool,
          request,
          questions,
          req.user.id,
          {
            exam: context.exam,
            section,
            topic,
            language: request.language,
            difficulty: request.difficulty,
            questionCount: request.count
          }
        );
      } catch (error) {
        if (error instanceof DuplicateQuestionError) {
          return res.status(409).json({
            success: false,
            message: "A question in this batch already exists in the question bank"
          });
        }
        console.error("Unable to save generated questions");
        return res.status(500).json({
          success: false,
          message: "Generated questions could not be saved"
        });
      }

      return res.status(200).json({
        success: true,
        generationRequestId: saved.generationRequestId,
        exam: context.exam,
        section,
        topic,
        count: questions.length,
        savedCount: saved.questionIds.length,
        questionIds: saved.questionIds,
        data: questions.map((question, index) => ({
          id: saved.questionIds[index],
          ...question
        }))
      });
    } catch {
      console.error("Unable to load question generation context");
      return res.status(500).json({
        success: false,
        message: "Question generation could not be completed"
      });
    }
  }
);

module.exports = router;
