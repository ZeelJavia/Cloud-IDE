const fs = require("fs");
const path = require("path");
const config = require("../config");
const { getModels } = require("../config/database");
const { getDirectoryTree } = require("../utils/fileUtils");

class ProjectService {
  constructor() {
    this.PROJECTS_DIR = config.getProjectsDir();
    if (!fs.existsSync(this.PROJECTS_DIR)) {
      fs.mkdirSync(this.PROJECTS_DIR, { recursive: true });
    }
  }

  async getAllProjects(userId) {
    const { ProjectModel } = getModels();

    if (config.USE_DB_PROJECTS_BOOL && ProjectModel) {
      const docs = await ProjectModel.find({ owner: userId })
        .select("name")
        .lean();
      return docs.map((d) => d.name);
    }

    const projects = fs
      .readdirSync(this.PROJECTS_DIR)
      .filter((item) =>
        fs.statSync(path.join(this.PROJECTS_DIR, item)).isDirectory()
      );
    return projects;
  }

  async createProject(projectName, userId) {
    const { ProjectModel } = getModels();

    if (config.USE_DB_PROJECTS_BOOL && ProjectModel) {
      const exists = await ProjectModel.findOne({
        owner: userId,
        name: projectName,
      });
      if (exists) {
        throw new Error("Project already exists");
      }
      const project = await ProjectModel.create({
        owner: userId,
        name: projectName,
      });
      return { success: true, message: "Project created", id: project._id };
    }

    const projectPath = path.join(this.PROJECTS_DIR, projectName);
    if (fs.existsSync(projectPath)) {
      throw new Error("Project already exists");
    }
    fs.mkdirSync(projectPath, { recursive: true });
    return { success: true, message: "Project created successfully" };
  }

  async deleteProject(projectName, userId) {
    const { ProjectModel, FileModel } = getModels();

    if (config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
      const project = await ProjectModel.findOne({
        owner: userId,
        name: projectName,
      });
      if (!project) {
        throw new Error("Project not found");
      }

      // Delete all files in the project
      await FileModel.deleteMany({ project: project._id });

      // Delete the project
      await ProjectModel.deleteOne({ _id: project._id });

      return { success: true, message: "Project deleted successfully" };
    }

    // Filesystem approach
    const projectPath = path.join(this.PROJECTS_DIR, projectName);
    if (!fs.existsSync(projectPath)) {
      throw new Error("Project not found");
    }

    // Remove the entire project directory
    fs.rmSync(projectPath, { recursive: true, force: true });

    return { success: true, message: "Project deleted successfully" };
  }

  async getProjectStructure(projectName, userId) {
    const { ProjectModel, FileModel, projectTreeUtils } = getModels();

    if (config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
      const project = await ProjectModel.findOne({
        owner: userId,
        name: projectName,
      });
      if (!project) {
        throw new Error("Project not found");
      }

      // Clean up duplicates in database first
      const duplicates = await FileModel.aggregate([
        { $match: { project: project._id } },
        {
          $group: {
            _id: "$path",
            count: { $sum: 1 },
            docs: { $push: "$$ROOT" },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ]);

      // Remove duplicate entries, keeping the most recent one
      for (const dup of duplicates) {
        const sorted = dup.docs.sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt) -
            new Date(a.updatedAt || a.createdAt)
        );
        const toRemove = sorted.slice(1); // Keep the first (most recent), remove the rest
        await FileModel.deleteMany({
          _id: { $in: toRemove.map((d) => d._id) },
        });
        console.log(
          `Removed ${toRemove.length} duplicate entries for path: ${dup._id}`
        );
      }

      const files = await FileModel.find({
        project: project._id,
      }).lean();

      // Remove duplicates based on path
      const uniqueFiles = files.reduce((acc, file) => {
        const existingIndex = acc.findIndex((f) => f.path === file.path);
        if (existingIndex === -1) {
          acc.push(file);
        } else {
          // Keep the most recent entry (by updatedAt or createdAt)
          const existing = acc[existingIndex];
          if (
            file.updatedAt > existing.updatedAt ||
            file.createdAt > existing.createdAt
          ) {
            acc[existingIndex] = file;
          }
        }
        return acc;
      }, []);

      const tree = projectTreeUtils.buildTree(uniqueFiles);
      return tree;
    }

    const projectPath = path.join(this.PROJECTS_DIR, projectName);
    if (!fs.existsSync(projectPath)) {
      throw new Error("Project not found");
    }
    const files = getDirectoryTree(projectPath);
    return files;
  }

  // Alias methods expected by tests
  async getProjects(userId) {
    return this.getAllProjects(userId);
  }

  async getProject(projectName, userId) {
    if (!projectName) {
      throw new Error("Project name is required");
    }
    return this.getProjectStructure(projectName, userId);
  }

  async updateProject(projectName, userId, updateData) {
    const { ProjectModel } = getModels();

    if (config.USE_DB_PROJECTS_BOOL && ProjectModel) {
      const project = await ProjectModel.findOne({
        owner: userId,
        name: projectName,
      });
      if (!project) {
        throw new Error("Project not found");
      }

      const updated = await ProjectModel.findByIdAndUpdate(
        project._id,
        updateData,
        { new: true }
      );
      return { success: true, project: updated };
    }

    // Filesystem projects don't support metadata updates
    return { success: true, message: "Project exists" };
  }

  // Validation method expected by tests
  validateProjectData(projectData) {
    if (!projectData || !projectData.name) {
      throw new Error("Project name is required");
    }
    if (projectData.name.length < 1) {
      throw new Error("Project name cannot be empty");
    }
    return true;
  }
}

module.exports = new ProjectService();
