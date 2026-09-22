const express = require("express");

const router = express.Router();

// Get all subjects
router.get("/", async (req, res) => {
  try {
    const result = await req.app.locals.pool.query(
      `
      SELECT
        s.id,
        s.exam_id,
        e.name AS exam_name,
        e.slug AS exam_slug,
        s.name,
        s.slug,
        s.description,
        s.is_active,
        s.display_order,
        s.created_at,
        s.updated_at
      FROM subjects s
      INNER JOIN exams e ON e.id = s.exam_id
      ORDER BY s.exam_id ASC, s.display_order ASC, s.id ASC
      `
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error("Error fetching subjects:", error.message);

    res.status(500).json({
      success: false,
      message: "Failed to fetch subjects"
    });
  }
});

module.exports = router;