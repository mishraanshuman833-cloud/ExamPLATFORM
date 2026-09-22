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
const geminiRoutes = require("./routes/geminiRoutes");
const pool = require("./config/db");

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