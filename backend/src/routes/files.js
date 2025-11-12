const express = require("express");
const router = express.Router();
const fileController = require("../controllers/fileController");
const { authenticateToken } = require("../middleware/auth");

// Get file content
router.get(
  "/:projectName/files/*",
  authenticateToken,
  fileController.getFileContent
);

// Save file content
router.put(
  "/:projectName/files/*",
  authenticateToken,
  fileController.saveFileContent
);

// Create new file or folder
router.post(
  "/:projectName/files",
  authenticateToken,
  fileController.createFileOrFolder
);

// Delete file or folder
router.delete(
  "/:projectName/files/*",
  authenticateToken,
  fileController.deleteFileOrFolder
);

// Rename file or folder
router.patch(
  "/:projectName/files/*",
  authenticateToken,
  fileController.renameFileOrFolder
);

module.exports = router;
