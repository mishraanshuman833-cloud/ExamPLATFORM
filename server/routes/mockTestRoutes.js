const express = require("express");
const { createMockTestAttemptToken } = require("../middleware/mockTestAttempt");

const router = express.Router();

router.post("/:testId/start", async (req, res) => {
  const testId = req.params.testId;
  if (!/^[1-9]\d*$/.test(testId)) {
    return res.status(400).json({
      success: false,
      message: "A valid mock test ID is required"
    });
  }

  try {
    const result = await req.app.locals.pool.query(
      `
      SELECT mt.id, mt.duration_minutes
      FROM mock_tests mt
      INNER JOIN exams e ON e.id = mt.exam_id
      WHERE mt.id = $1
        AND mt.is_published = TRUE
        AND e.is_active = TRUE
      `,
      [testId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Mock test not found"
      });
    }

    const test = result.rows[0];
    const startedAt = Date.now();
    const durationMinutes = Number(test.duration_minutes);
    const deadline = startedAt + durationMinutes * 60 * 1000;
    return res.json({
      success: true,
      durationMinutes,
      deadline,
      attemptToken: createMockTestAttemptToken(test.id, durationMinutes, startedAt)
    });
  } catch (error) {
    console.error("Unable to start mock test:", error.message);
    return res.status(500).json({
      success: false,
      message: "Mock test could not be started"
    });
  }
});

router.get("/:testId", async (req, res) => {
  try {
    const result = await req.app.locals.pool.query(
      `
      SELECT
        mt.id AS test_id,
        mt.exam_id,
        e.name AS exam_name,
        mt.title,
        mt.description,
        mt.duration_minutes,
        mt.total_questions,
        mt.total_marks,
        mtq.question_order,
        q.id AS question_id,
        q.question_text,
        q.question_type,
        q.difficulty,
        q.language,
        mtq.marks,
        s.id AS section_id,
        s.name AS subject_name,
        t.name AS topic_name,
        qo.id AS option_id,
        qo.option_key,
        qo.option_text
      FROM mock_tests mt
      INNER JOIN exams e ON e.id = mt.exam_id
      INNER JOIN mock_test_questions mtq ON mtq.mock_test_id = mt.id
      INNER JOIN questions q ON q.id = mtq.question_id
      LEFT JOIN topics t ON t.id = q.topic_id
      LEFT JOIN subjects s ON s.id = t.subject_id
      LEFT JOIN question_options qo ON qo.question_id = q.id
      WHERE mt.id::text = $1
        AND mt.is_published = TRUE
        AND e.is_active = TRUE
        AND q.is_published = TRUE
        AND q.review_status = 'approved'
      ORDER BY mtq.question_order ASC, qo.option_key ASC
      `,
      [req.params.testId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Mock test not found"
      });
    }

    const first = result.rows[0];
    const questionsById = new Map();

    for (const row of result.rows) {
      if (!questionsById.has(row.question_id)) {
        questionsById.set(row.question_id, {
          id: row.question_id,
          order: row.question_order,
          text: row.question_text,
          type: row.question_type,
          difficulty: row.difficulty,
          language: row.language,
          marks: row.marks,
          sectionId: row.section_id,
          subject: row.subject_name,
          topic: row.topic_name,
          options: []
        });
      }

      if (row.option_id !== null) {
        questionsById.get(row.question_id).options.push({
          id: row.option_id,
          key: row.option_key,
          text: row.option_text
        });
      }
    }

    res.json({
      success: true,
      data: {
        id: first.test_id,
        examId: first.exam_id,
        examName: first.exam_name,
        title: first.title,
        description: first.description,
        durationMinutes: first.duration_minutes,
        totalQuestions: first.total_questions,
        totalMarks: first.total_marks,
        questions: Array.from(questionsById.values())
      }
    });
  } catch (error) {
    console.error("Error fetching mock test:", error.message);

    res.status(500).json({
      success: false,
      message: "Failed to fetch mock test"
    });
  }
});

module.exports = router;
