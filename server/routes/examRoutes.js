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

module.exports = router;