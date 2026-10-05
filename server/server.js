const express = require("express");
const cors = require("cors");
const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, ".env")
});

const { GoogleGenerativeAI } = require("@google/generative-ai");

const healthRoutes = require("./routes/healthRoutes");
const examRoutes = require("./routes/examRoutes");
const subjectRoutes = require("./routes/subjectRoutes");
const topicsRoutes = require("./routes/topicsRoutes");
const questionRoutes = require("./routes/questionRoutes");
const practiceQuestionRoutes = require("./routes/practiceQuestionRoutes");
const adminQuestionBankRoutes = require("./routes/adminQuestionBankRoutes");
const examPatternRoutes = require("./routes/examPatternRoutes");
const geminiRoutes = require("./routes/geminiRoutes");
const mockTestRoutes = require("./routes/mockTestRoutes");
const resultRoutes = require("./routes/resultRoutes");
const authRoutes = require("./routes/authRoutes");
const pool = require("./config/db");
const { sendRegistrationOtp } = require("./services/registrationEmail");

const app = express();
const PORT = process.env.PORT || 5000;

// ================================
// Gemini AI
// ================================

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Make Gemini available to routes
app.locals.genAI = genAI;

// ================================
// Database
// ================================

// Make database pool available to routes
app.locals.pool = pool;
app.locals.sendRegistrationOtp = sendRegistrationOtp;

// ================================
// Middleware
// ================================

app.use(cors());
app.use(express.json());

// Serve student client
app.use(express.static(path.join(__dirname, "../client")));

// ================================
// API Routes
// ================================

app.use("/api/health", healthRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/subjects", subjectRoutes);
app.use("/api/topics", topicsRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/practice/questions", practiceQuestionRoutes);
app.use("/api/admin/question-bank", adminQuestionBankRoutes);
app.use("/api/exam-patterns", examPatternRoutes);
app.use("/api/mock-tests", mockTestRoutes);
app.use("/api/results", resultRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/gemini", geminiRoutes);

// ================================
// Test PostgreSQL connection
// ================================

pool.query("SELECT NOW()")
  .then(() => {
    console.log("PostgreSQL database connected successfully");
  })
  .catch((error) => {
    console.error("PostgreSQL connection failed:", error.message);
  });

// ================================
// Start server
// ================================

app.listen(PORT, () => {
  console.log(`ExamPlatform server running on http://localhost:${PORT}`);
});