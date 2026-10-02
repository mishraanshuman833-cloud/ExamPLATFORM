const express = require("express");

const router = express.Router();

// ================================
// Test Gemini connection
// ================================

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

// ================================
// Generate AI Questions
// ================================

router.post("/generate-questions", async (req, res) => {
  try {
    const {
      exam,
      subject,
      topic,
      count,
      difficulty
    } = req.body;

    // -------------------------------
    // Validate input
    // -------------------------------

    if (!exam || !subject || !topic) {
      return res.status(400).json({
        success: false,
        message: "Exam, subject and topic are required"
      });
    }

    const questionCount = Number(count) || 5;

    if (questionCount < 1 || questionCount > 50) {
      return res.status(400).json({
        success: false,
        message: "Question count must be between 1 and 50"
      });
    }

    const selectedDifficulty = difficulty || "Medium";

    // -------------------------------
    // Gemini model
    // -------------------------------

    const genAI = req.app.locals.genAI;

    const model = genAI.getGenerativeModel({
      model: "gemini-3.6-flash",
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    // -------------------------------
    // Prompt
    // -------------------------------

    const prompt = `
You are an expert competitive-exam question setter.

Generate ${questionCount} multiple-choice questions for:

Exam: ${exam}
Subject: ${subject}
Topic: ${topic}
Difficulty: ${selectedDifficulty}

Requirements:

1. Questions must be suitable for Indian competitive examinations.
2. Questions must be factually accurate.
3. Each question must have exactly 4 options.
4. Only one option must be correct.
5. Provide a clear explanation for the correct answer.
6. Do not generate duplicate questions.
7. Do not use vague or ambiguous questions.
8. Keep the language suitable for the selected exam.
9. Do not include markdown.
10. Return ONLY valid JSON.

Return this exact JSON structure:

{
  "questions": [
    {
      "question_text": "Question here",
      "question_type": "mcq",
      "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
      ],
      "correct_answer": "Option A",
      "explanation": "Explanation here",
      "difficulty": "${selectedDifficulty}",
      "question_origin": "ai_generated",
      "ai_generated": true,
      "review_status": "pending"
    }
  ]
}
`;

    // -------------------------------
    // Generate
    // -------------------------------

    const result = await model.generateContent(prompt);

    const responseText = result.response.text();

    // -------------------------------
    // Parse JSON
    // -------------------------------

    let generatedData;

    try {
      generatedData = JSON.parse(responseText);
    } catch (parseError) {
      console.error("GEMINI JSON PARSE ERROR:", parseError);

      return res.status(500).json({
        success: false,
        message: "Gemini returned invalid JSON",
        raw_response: responseText
      });
    }

    // -------------------------------
    // Validate generated questions
    // -------------------------------

    if (
      !generatedData ||
      !Array.isArray(generatedData.questions)
    ) {
      return res.status(500).json({
        success: false,
        message: "Invalid question data received from Gemini"
      });
    }

    res.status(200).json({
      success: true,
      exam,
      subject,
      topic,
      count: generatedData.questions.length,
      data: generatedData.questions
    });

  } catch (error) {
    console.error("GENERATE QUESTIONS ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to generate questions",
      error: error.message
    });
  }
});

module.exports = router;