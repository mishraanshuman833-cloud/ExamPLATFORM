const express = require("express");

const router = express.Router();

// Test Gemini connection
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

module.exports = router;