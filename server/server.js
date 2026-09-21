const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const healthRoutes = require("./routes/healthRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve student client
app.use(express.static(path.join(__dirname, "../client")));

// API Routes
app.use("/api/health", healthRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`ExamPlatform server running on http://localhost:${PORT}`);
});