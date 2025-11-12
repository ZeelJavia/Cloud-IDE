const projectService = require("../services/projectService");

class ProjectController {
  async getAllProjects(req, res) {
    try {
      const projects = await projectService.getAllProjects(req.user.id);
      res.json(projects);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createProject(req, res) {
    const { name: projectName } = req.body || {};
    if (!projectName)
      return res.status(400).json({ error: "Project name required" });

    try {
      const result = await projectService.createProject(
        projectName,
        req.user.id
      );
      res.json(result);
    } catch (error) {
      if (error.message === "Project already exists") {
        return res.status(409).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  }

  async deleteProject(req, res) {
    const { projectName } = req.params;
    try {
      const result = await projectService.deleteProject(
        projectName,
        req.user.id
      );
      res.json(result);
    } catch (error) {
      if (error.message === "Project not found") {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  }

  async getProjectFiles(req, res) {
    const { projectName } = req.params;
    try {
      const files = await projectService.getProjectStructure(
        projectName,
        req.user.id
      );
      res.json(files);
    } catch (error) {
      if (error.message === "Project not found") {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new ProjectController();
