const express = require("express");
const { getAuthenticatedUser, requireAuthenticatedUser } = require("../middleware/authSession");
const { validateMockTestAttemptToken } = require("../middleware/mockTestAttempt");

const router = express.Router();

function isPositiveId(value) {
  return (
    (typeof value === "string" || Number.isSafeInteger(value)) &&
    /^[1-9]\d*$/.test(String(value))
  );
}

router.get("/attempts", requireAuthenticatedUser, async (req, res) => {
  try {
    const result = await req.app.locals.pool.query(
      `
      SELECT
        a.id AS "attemptId",
        a.submitted_at AS "submittedAt",
        a.total_questions AS "totalQuestions",
        a.attempted_questions AS "attemptedQuestions",
        a.correct_answers AS "correctAnswers",
        a.wrong_answers AS "wrongAnswers",
        a.skipped_questions AS "skippedQuestions",
        a.score,
        a.accuracy,
        mt.id AS "mockTestId",
        mt.title AS "testTitle",
        mt.total_marks AS "totalMarks",
        e.name AS "examName"
      FROM attempts a
      INNER JOIN mock_tests mt ON mt.id = a.mock_test_id
      INNER JOIN exams e ON e.id = mt.exam_id
      WHERE a.user_id = $1
        AND a.status = 'completed'
      ORDER BY a.submitted_at DESC, a.id DESC
      `,
      [req.user.id]
    );

    return res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error("Error retrieving authenticated attempt history:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve attempt history"
    });
  }
});

router.get("/attempts/:attemptId", requireAuthenticatedUser, async (req, res) => {
  if (!isPositiveId(req.params.attemptId)) {
    return res.status(400).json({
      success: false,
      message: "A valid attempt ID is required"
    });
  }

  try {
    const result = await req.app.locals.pool.query(
      `
      SELECT
        a.id AS "attemptId",
        a.submitted_at AS "submittedAt",
        a.total_questions AS "totalQuestions",
        a.attempted_questions AS "attemptedQuestions",
        a.correct_answers AS "correctAnswers",
        a.wrong_answers AS "wrongAnswers",
        a.skipped_questions AS "skippedQuestions",
        a.score,
        a.accuracy,
        mt.id AS "mockTestId",
        mt.title AS "testTitle",
        mt.total_marks AS "totalMarks",
        e.name AS "examName",
        q.id AS "questionId",
        q.question_text AS question,
        q.language,
        q.explanation,
        aa.is_correct AS "isCorrect",
        so.option_key AS "selectedOptionKey",
        so.option_text AS "selectedOptionText",
        co.option_key AS "correctOptionKey",
        co.option_text AS "correctOptionText"
      FROM attempts a
      INNER JOIN mock_tests mt ON mt.id = a.mock_test_id
      INNER JOIN exams e ON e.id = mt.exam_id
      INNER JOIN mock_test_questions mtq ON mtq.mock_test_id = mt.id
      INNER JOIN questions q ON q.id = mtq.question_id
      LEFT JOIN attempt_answers aa
        ON aa.attempt_id = a.id AND aa.question_id = q.id
      LEFT JOIN question_options so
        ON so.id = aa.selected_option_id AND so.question_id = q.id
      LEFT JOIN LATERAL (
        SELECT option_key, option_text
        FROM question_options
        WHERE question_id = q.id AND is_correct = TRUE
        ORDER BY id
        LIMIT 1
      ) co ON TRUE
      WHERE a.id = $1
        AND a.user_id = $2
        AND a.status = 'completed'
      ORDER BY mtq.question_order ASC
      `,
      [req.params.attemptId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Attempt not found"
      });
    }

    const firstRow = result.rows[0];
    const answers = result.rows.map((row) => ({
      questionId: String(row.questionId),
      question: row.question,
      language: row.language,
      selectedOption: row.selectedOptionKey === null
        ? null
        : { key: row.selectedOptionKey, text: row.selectedOptionText },
      correctOption: row.correctOptionKey === null
        ? null
        : { key: row.correctOptionKey, text: row.correctOptionText },
      isCorrect: row.isCorrect,
      status: row.isCorrect === true
        ? "correct"
        : row.isCorrect === false
          ? "wrong"
          : "skipped",
      explanation: row.explanation
    }));

    return res.json({
      success: true,
      data: {
        attemptId: firstRow.attemptId,
        submittedAt: firstRow.submittedAt,
        examName: firstRow.examName,
        testTitle: firstRow.testTitle,
        mockTestId: firstRow.mockTestId,
        totalMarks: firstRow.totalMarks,
        totalQuestions: firstRow.totalQuestions,
        attemptedQuestions: firstRow.attemptedQuestions,
        correctAnswers: firstRow.correctAnswers,
        wrongAnswers: firstRow.wrongAnswers,
        skippedQuestions: firstRow.skippedQuestions,
        score: firstRow.score,
        accuracy: firstRow.accuracy,
        answers
      }
    });
  } catch (error) {
    console.error("Error retrieving authenticated attempt review:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve attempt review"
    });
  }
});

router.get("/attempts/:attemptId/wrong-questions", requireAuthenticatedUser, async (req, res) => {
  if (!isPositiveId(req.params.attemptId)) {
    return res.status(400).json({
      success: false,
      message: "A valid attempt ID is required"
    });
  }

  try {
    const result = await req.app.locals.pool.query(
      `
      WITH owned_attempt AS (
        SELECT
          a.id AS "attemptId",
          mt.id AS "mockTestId",
          mt.title AS "testTitle",
          e.name AS "examName"
        FROM attempts a
        INNER JOIN mock_tests mt ON mt.id = a.mock_test_id
        INNER JOIN exams e ON e.id = mt.exam_id
        WHERE a.id = $1
          AND a.user_id = $2
          AND a.status = 'completed'
      )
      SELECT
        oa."attemptId",
        oa."testTitle",
        oa."examName",
        mtq.question_order AS "questionOrder",
        q.id AS "questionId",
        q.question_text AS question,
        q.question_type AS "questionType",
        q.difficulty,
        q.language,
        q.explanation,
        q.marks,
        q.negative_marks AS "negativeMarks",
        q.topic_id AS "topicId",
        t.name AS topic,
        s.id AS "subjectId",
        s.name AS subject,
        qo.id AS "optionId",
        qo.option_key AS "optionKey",
        qo.option_text AS "optionText",
        qo.is_correct AS "optionIsCorrect"
      FROM owned_attempt oa
      LEFT JOIN attempt_answers aa
        ON aa.attempt_id = oa."attemptId"
        AND aa.is_correct = FALSE
      LEFT JOIN questions q ON q.id = aa.question_id
      LEFT JOIN mock_test_questions mtq
        ON mtq.mock_test_id = oa."mockTestId"
        AND mtq.question_id = q.id
      LEFT JOIN topics t ON t.id = q.topic_id
      LEFT JOIN subjects s ON s.id = t.subject_id
      LEFT JOIN question_options qo ON qo.question_id = q.id
      ORDER BY mtq.question_order NULLS LAST, qo.option_key ASC
      `,
      [req.params.attemptId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Attempt not found"
      });
    }

    const firstRow = result.rows[0];
    const questionsById = new Map();
    for (const row of result.rows) {
      if (row.questionId === null) {
        continue;
      }

      const questionId = String(row.questionId);
      if (!questionsById.has(questionId)) {
        questionsById.set(questionId, {
          id: questionId,
          order: row.questionOrder,
          text: row.question,
          type: row.questionType,
          difficulty: row.difficulty,
          language: row.language,
          explanation: row.explanation,
          marks: row.marks,
          negativeMarks: row.negativeMarks,
          topicId: row.topicId,
          topic: row.topic,
          subjectId: row.subjectId,
          subject: row.subject,
          options: [],
          correctOption: null
        });
      }

      if (row.optionId !== null) {
        const option = {
          id: String(row.optionId),
          key: row.optionKey,
          text: row.optionText
        };
        const question = questionsById.get(questionId);
        question.options.push(option);
        if (row.optionIsCorrect) {
          question.correctOption = option;
        }
      }
    }

    return res.json({
      success: true,
      data: {
        attemptId: firstRow.attemptId,
        testTitle: firstRow.testTitle,
        examName: firstRow.examName,
        questions: Array.from(questionsById.values())
      }
    });
  } catch (error) {
    console.error("Error retrieving wrong questions for practice:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve wrong questions"
    });
  }
});

router.post("/", async (req, res) => {
  const { mockTestId, answers, attemptToken, autoSubmit } = req.body || {};

  if (!isPositiveId(mockTestId) || !Array.isArray(answers)) {
    return res.status(400).json({
      success: false,
      message: "A valid mockTestId and answers array are required"
    });
  }

  let attemptStatus;
  try {
    attemptStatus = validateMockTestAttemptToken(
      attemptToken,
      mockTestId,
      Date.now(),
      autoSubmit === true
    );
  } catch (error) {
    console.error("Unable to validate mock test deadline:", error.message);
    return res.status(503).json({
      success: false,
      message: "Mock test submission is temporarily unavailable"
    });
  }
  if (attemptStatus === "expired") {
    return res.status(410).json({
      success: false,
      message: "The mock test time limit has expired"
    });
  }
  if (attemptStatus !== "valid" && attemptStatus !== "automatic-grace") {
    return res.status(400).json({
      success: false,
      message: "A valid mock test attempt is required"
    });
  }

  const submittedAnswers = new Map();

  for (const answer of answers) {
    if (
      !answer ||
      !isPositiveId(answer.questionId) ||
      (answer.selectedOptionId !== null &&
        !isPositiveId(answer.selectedOptionId)) ||
      submittedAnswers.has(String(answer.questionId))
    ) {
      return res.status(400).json({
        success: false,
        message: "Each answer must have a unique questionId and a valid option"
      });
    }

    submittedAnswers.set(String(answer.questionId), answer.selectedOptionId);
  }

  const pool = req.app.locals.pool;
  let client;
  let transactionStarted = false;

  try {
    const authenticatedUser = await getAuthenticatedUser(req, pool);
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const questionResult = await client.query(
      `
      SELECT
        mt.id AS test_id,
        mtq.question_id,
        mtq.marks,
        q.negative_marks,
        q.question_text,
        q.language,
        q.explanation,
        qo.id AS option_id,
        qo.option_key,
        qo.option_text,
        qo.is_correct
      FROM mock_tests mt
      INNER JOIN mock_test_questions mtq ON mtq.mock_test_id = mt.id
      INNER JOIN questions q ON q.id = mtq.question_id
      LEFT JOIN question_options qo ON qo.question_id = q.id
      WHERE mt.id = $1
        AND mt.is_published = TRUE
        AND q.is_published = TRUE
        AND q.review_status = 'approved'
      ORDER BY mtq.question_order ASC, qo.option_key ASC
      `,
      [mockTestId]
    );

    if (questionResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(404).json({
        success: false,
        message: "Mock test not found"
      });
    }

    const questionsById = new Map();

    for (const row of questionResult.rows) {
      const questionId = String(row.question_id);
      if (!questionsById.has(questionId)) {
        questionsById.set(questionId, {
          id: questionId,
          text: row.question_text,
          language: row.language,
          explanation: row.explanation,
          marks: Number(row.marks),
          negativeMarks: Number(row.negative_marks),
          options: new Map()
        });
      }

      if (row.option_id !== null) {
        questionsById.get(questionId).options.set(String(row.option_id), {
          id: String(row.option_id),
          key: row.option_key,
          text: row.option_text,
          isCorrect: row.is_correct
        });
      }
    }

    for (const [questionId, selectedOptionId] of submittedAnswers) {
      const question = questionsById.get(questionId);
      if (
        !question ||
        (selectedOptionId !== null &&
          !question.options.has(String(selectedOptionId)))
      ) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(400).json({
          success: false,
          message: "An answer references a question or option outside this test"
        });
      }
    }

    const evaluatedAnswers = Array.from(questionsById.values()).map((question) => {
      const selectedId = submittedAnswers.get(question.id);
      const selectedOption =
        selectedId === null || selectedId === undefined
          ? null
          : question.options.get(String(selectedId));
      const correctOption = Array.from(question.options.values()).find(
        (option) => option.isCorrect
      );
      const isCorrect = selectedOption ? selectedOption.isCorrect : null;

      return {
        questionId: question.id,
        question: question.text,
        language: question.language,
        selectedOptionId: selectedOption ? selectedOption.id : null,
        selectedOption: selectedOption
          ? { key: selectedOption.key, text: selectedOption.text }
          : null,
        correctOption: correctOption
          ? { key: correctOption.key, text: correctOption.text }
          : null,
        isCorrect,
        explanation: question.explanation,
        marksObtained:
          isCorrect === true
            ? question.marks
            : selectedOption
              ? -question.negativeMarks
              : 0
      };
    });

    const totalQuestions = evaluatedAnswers.length;
    const correctAnswers = evaluatedAnswers.filter(
      (answer) => answer.isCorrect === true
    ).length;
    const wrongAnswers = evaluatedAnswers.filter(
      (answer) => answer.isCorrect === false
    ).length;
    const attemptedQuestions = correctAnswers + wrongAnswers;
    const skippedQuestions = totalQuestions - attemptedQuestions;
    const score = evaluatedAnswers.reduce(
      (total, answer) => total + answer.marksObtained,
      0
    );
    const accuracy =
      attemptedQuestions === 0
        ? 0
        : Number(((correctAnswers / attemptedQuestions) * 100).toFixed(2));

    const attemptResult = await client.query(
      `
      INSERT INTO attempts (
        user_id,
        mock_test_id,
        submitted_at,
        total_questions,
        attempted_questions,
        correct_answers,
        wrong_answers,
        skipped_questions,
        score,
        accuracy,
        status
      )
      VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, 'completed')
      RETURNING id, submitted_at
      `,
      [
        authenticatedUser ? authenticatedUser.id : null,
        mockTestId,
        totalQuestions,
        attemptedQuestions,
        correctAnswers,
        wrongAnswers,
        skippedQuestions,
        score,
        accuracy
      ]
    );

    const attemptId = attemptResult.rows[0].id;

    for (const answer of evaluatedAnswers) {
      await client.query(
        `
        INSERT INTO attempt_answers (
          attempt_id,
          question_id,
          selected_option_id,
          is_correct,
          marks_obtained
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          attemptId,
          answer.questionId,
          answer.selectedOptionId,
          answer.isCorrect,
          answer.marksObtained
        ]
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    res.status(201).json({
      success: true,
      data: {
        attemptId,
        accountOwned: Boolean(authenticatedUser),
        submittedAt: attemptResult.rows[0].submitted_at,
        totalQuestions,
        attemptedQuestions,
        correctAnswers,
        wrongAnswers,
        skippedQuestions,
        score,
        accuracy,
        answers: evaluatedAnswers
      }
    });
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK");
    }

    console.error("Error submitting mock test result:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to submit mock test result"
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;
