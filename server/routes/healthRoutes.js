const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "ExamPlatform server is running"
  });
});

module.exports = router;
