const express = require("express");

const router = express.Router();

// Get all questions
router.get("/", async (req, res) => {
  try {
    const result = await req.app.locals.pool.query(
      `
      SELECT
        q.id,
        q.topic_id,
        t.name AS topic_name,
        s.id AS subject_id,
        s.name AS subject_name,
        e.id AS exam_id,
        e.name AS exam_name,
        q.question_text,
        q.question_type,
        q.explanation,
        q.difficulty,
        q.marks,
        q.negative_marks,
        q.question_origin,
        q.ai_generated,
        q.review_status
      FROM questions q
      LEFT JOIN topics t ON t.id = q.topic_id
      LEFT JOIN subjects s ON s.id = t.subject_id
      LEFT JOIN exams e ON e.id = s.exam_id
      ORDER BY q.id ASC
      `
    );

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error("QUESTIONS API ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch questions",
      error: error.message
    });
  }
});

module.exports = router;