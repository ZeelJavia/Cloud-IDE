const fileService = require("../services/fileService");

class FileController {
  async getFileContent(req, res) {
    const { projectName } = req.params;
    const filePath = req.params[0];
    try {
      const fileData = await fileService.getFileContent(
        projectName,
        filePath,
        req.user.id
      );
      res.json(fileData);
    } catch (error) {
      if (
        error.message === "Project not found" ||
        error.message === "File not found"
      ) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  }

  async saveFileContent(req, res) {
    const { projectName } = req.params;
    const filePath = req.params[0];
    const { content } = req.body || {};
    try {
      const result = await fileService.saveFileContent(
        projectName,
        filePath,
        content,
        req.user.id,
        req.io
      );
      res.json(result);
    } catch (error) {
      if (
        error.message === "Project not found" ||
        error.message === "File not found"
      ) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  }

  async createFileOrFolder(req, res) {
    const { projectName } = req.params;
    const { filePath, content = "", type = "file" } = req.body || {};

    if (!filePath) return res.status(400).json({ error: "filePath required" });

    try {
      const result = await fileService.createFileOrFolder(
        projectName,
        filePath,
        content,
        type,
        req.user.id
      );
      res.json(result);
    } catch (error) {
      if (error.message === "Project not found") {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes("already exists")) {
        return res.status(409).json({ error: error.message });
      }
      console.error(`❌ Error creating ${type}:`, error);
      res.status(500).json({ error: error.message });
    }
  }

  async deleteFileOrFolder(req, res) {
    const { projectName } = req.params;
    const filePath = req.params[0];
    try {
      const result = await fileService.deleteFileOrFolder(
        projectName,
        filePath,
        req.user.id
      );
      res.json(result);
    } catch (error) {
      if (
        error.message === "Project not found" ||
        error.message === "Not found" ||
        error.message === "File or folder not found"
      ) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  }

  async renameFileOrFolder(req, res) {
    const { projectName } = req.params;
    const oldPath = req.params[0];
    const { newName } = req.body || {};

    if (!newName) return res.status(400).json({ error: "newName required" });

    try {
      const result = await fileService.renameFileOrFolder(
        projectName,
        oldPath,
        newName,
        req.user.id
      );
      res.json(result);
    } catch (error) {
      if (
        error.message === "Project not found" ||
        error.message === "File or folder not found"
      ) {
        return res.status(404).json({ error: error.message });
      }
      if (
        error.message === "Destination already exists" ||
        error.message === "File or folder with new name already exists"
      ) {
        return res.status(409).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new FileController();
