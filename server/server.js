const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, ".env")
});

const healthRoutes = require("./routes/healthRoutes");
const pool = require("./config/db");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve student client
app.use(express.static(path.join(__dirname, "../client")));

// API Routes
app.use("/api/health", healthRoutes);

// Test PostgreSQL connection
pool.query("SELECT NOW()")
  .then(() => {
    console.log("PostgreSQL database connected successfully");
  })
  .catch((error) => {
    console.error("PostgreSQL connection failed:", error.message);
  });

// Start server
app.listen(PORT, () => {
  console.log(`ExamPlatform server running on http://localhost:${PORT}`);
});