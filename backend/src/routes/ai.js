const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");

// AI Code Generation
router.post("/generate", aiController.generateCode);

// AI Chat
router.post("/chat", aiController.chat);

// Code analysis and suggestions
router.post("/analyze", aiController.analyzeCode);

module.exports = router;
