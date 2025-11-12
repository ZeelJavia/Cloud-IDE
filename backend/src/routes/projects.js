const express = require("express");
const router = express.Router();
const projectController = require("../controllers/projectController");
const { authenticateToken } = require("../middleware/auth");

// Get all projects
router.get("/", authenticateToken, projectController.getAllProjects);

// Create new project
router.post("/", authenticateToken, projectController.createProject);

// Delete project
router.delete(
  "/:projectName",
  authenticateToken,
  projectController.deleteProject
);

// Get project file structure
router.get(
  "/:projectName/files",
  authenticateToken,
  projectController.getProjectFiles
);

module.exports = router;
