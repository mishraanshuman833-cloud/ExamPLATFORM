const express = require("express");

const router = express.Router();

// Get all topics
router.get("/", async (req, res) => {
  try {
    const result = await req.app.locals.pool.query(
      `
      SELECT
        t.id,
        t.subject_id,
        s.name AS subject_name,
        s.slug AS subject_slug,
        e.id AS exam_id,
        e.name AS exam_name,
        e.slug AS exam_slug,
        t.name,
        t.slug,
        t.description,
        t.is_active,
        t.display_order,
        t.created_at,
        t.updated_at
      FROM topics t
      INNER JOIN subjects s ON s.id = t.subject_id
      INNER JOIN exams e ON e.id = s.exam_id
      ORDER BY e.id ASC, s.display_order ASC, t.display_order ASC, t.id ASC
      `
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error("Error fetching topics:", error.message);

    res.status(500).json({
      success: false,
      message: "Failed to fetch topics"
    });
  }
});

module.exports = router;