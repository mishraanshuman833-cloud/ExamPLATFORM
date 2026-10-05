const express = require("express");
const { requireAuthenticatedUser } = require("../middleware/authSession");

const router = express.Router();
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const LANGUAGES = new Set(["en", "hi"]);
const MAX_DATABASE_ID = 9223372036854775807n;

function getOptionalQueryValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isValidDatabaseId(value) {
  return (
    value.length <= 19 &&
    /^[1-9]\d*$/.test(value) &&
    BigInt(value) <= MAX_DATABASE_ID
  );
}

router.get("/", requireAuthenticatedUser, async (req, res) => {
  const examId = getOptionalQueryValue(req.query.examId);
  const sectionId = getOptionalQueryValue(req.query.sectionId);
  const topicId = getOptionalQueryValue(req.query.topicId);
  const difficulty = getOptionalQueryValue(req.query.difficulty)?.toLowerCase() || null;
  const language = getOptionalQueryValue(req.query.language)?.toLowerCase() || null;

  if (examId && !/^(?:[1-9]\d*|[a-z0-9-]{1,180})$/i.test(examId)) {
    return res.status(400).json({
      success: false,
      message: "A valid examId or exam slug is required"
    });
  }
  if (sectionId && !isValidDatabaseId(sectionId)) {
    return res.status(400).json({
      success: false,
      message: "sectionId must be a positive integer"
    });
  }
  if (topicId && !isValidDatabaseId(topicId)) {
    return res.status(400).json({
      success: false,
      message: "topicId must be a positive integer"
    });
  }
  if (difficulty && !DIFFICULTIES.has(difficulty)) {
    return res.status(400).json({
      success: false,
      message: "difficulty must be easy, medium, or hard"
    });
  }
  if (language && !LANGUAGES.has(language)) {
    return res.status(400).json({
      success: false,
      message: "language must be en or hi"
    });
  }

  try {
    const result = await req.app.locals.pool.query(
      `
      SELECT
        q.id AS "questionId",
        q.topic_id AS "topicId",
        t.name AS topic,
        s.id AS "sectionId",
        s.name AS section,
        e.id AS "examId",
        e.name AS exam,
        q.question_text AS question,
        q.language,
        q.question_type AS "questionType",
        q.difficulty,
        q.marks,
        q.negative_marks AS "negativeMarks",
        q.explanation,
        qo.id AS "optionId",
        qo.option_key AS "optionKey",
        qo.option_text AS "optionText",
        qo.is_correct AS "optionIsCorrect"
      FROM questions q
      INNER JOIN topics t ON t.id = q.topic_id
      INNER JOIN subjects s ON s.id = t.subject_id
      INNER JOIN exams e ON e.id = s.exam_id
      INNER JOIN question_options qo ON qo.question_id = q.id
      WHERE q.is_published = TRUE
        AND q.review_status = 'approved'
        AND e.is_active = TRUE
        AND ($1::text IS NULL OR e.id::text = $1 OR e.slug = $1)
        AND ($2::bigint IS NULL OR s.id = $2)
        AND ($3::bigint IS NULL OR t.id = $3)
        AND ($4::text IS NULL OR q.difficulty = $4)
        AND ($5::text IS NULL OR q.language = $5)
      ORDER BY q.id ASC, qo.option_key ASC
      `,
      [examId, sectionId, topicId, difficulty, language]
    );

    const questionsById = new Map();
    for (const row of result.rows) {
      const questionId = String(row.questionId);
      if (!questionsById.has(questionId)) {
        questionsById.set(questionId, {
          id: questionId,
          topicId: String(row.topicId),
          topic: row.topic,
          sectionId: String(row.sectionId),
          section: row.section,
          examId: String(row.examId),
          exam: row.exam,
          question: row.question,
          language: row.language,
          questionType: row.questionType,
          difficulty: row.difficulty,
          marks: row.marks,
          negativeMarks: row.negativeMarks,
          explanation: row.explanation,
          options: [],
          correctAnswer: null
        });
      }

      const option = {
        id: String(row.optionId),
        key: row.optionKey,
        text: row.optionText
      };
      const question = questionsById.get(questionId);
      question.options.push(option);
      if (row.optionIsCorrect) {
        question.correctAnswer = option;
      }
    }

    const questions = Array.from(questionsById.values());
    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      success: true,
      count: questions.length,
      data: questions
    });
  } catch (error) {
    console.error("Error fetching authenticated practice questions:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch practice questions"
    });
  }
});

module.exports = router;
