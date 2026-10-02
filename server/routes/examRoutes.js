const express = require("express");

const router = express.Router();

// Get all exams
router.get("/", async (req, res) => {
  try {
    const result = await req.app.locals.pool.query(
      `
      SELECT
        id,
        name,
        slug,
        description,
        is_active,
        created_at,
        updated_at
      FROM exams
      ORDER BY id ASC
      `
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error("Error fetching exams:", error.message);

    res.status(500).json({
      success: false,
      message: "Failed to fetch exams"
    });
  }
});

router.get("/:examId/tests", async (req, res) => {
  try {
    const result = await req.app.locals.pool.query(
      `
      SELECT
        mt.id,
        mt.exam_id,
        mt.title,
        mt.description,
        mt.duration_minutes,
        mt.total_questions,
        mt.total_marks,
        mt.negative_marking
      FROM mock_tests mt
      INNER JOIN exams e ON e.id = mt.exam_id
      WHERE (e.id::text = $1 OR e.slug = $1)
        AND e.is_active = TRUE
        AND mt.is_published = TRUE
      ORDER BY mt.id ASC
      `,
      [req.params.examId]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error("Error fetching exam tests:", error.message);

    res.status(500).json({
      success: false,
      message: "Failed to fetch exam tests"
    });
  }
});

router.get("/:examId", async (req, res) => {
  try {
    const result = await req.app.locals.pool.query(
      `
      SELECT id, name, slug, description, is_active, created_at, updated_at
      FROM exams
      WHERE (id::text = $1 OR slug = $1)
        AND is_active = TRUE
      LIMIT 1
      `,
      [req.params.examId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Exam not found"
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Error fetching exam:", error.message);

    res.status(500).json({
      success: false,
      message: "Failed to fetch exam"
    });
  }
});

module.exports = router;