const express = require("express");

const router = express.Router();

function isPositiveId(value) {
  return (
    (typeof value === "string" || Number.isSafeInteger(value)) &&
    /^[1-9]\d*$/.test(String(value))
  );
}

router.post("/", async (req, res) => {
  const { mockTestId, answers } = req.body || {};

  if (!isPositiveId(mockTestId) || !Array.isArray(answers)) {
    return res.status(400).json({
      success: false,
      message: "A valid mockTestId and answers array are required"
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
      VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, 'completed')
      RETURNING id, submitted_at
      `,
      [
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
