const fs = require("fs");
const path = require("path");
const config = require("../config");
const { getModels } = require("../config/database");
const { getFileLanguage } = require("../utils/fileUtils");

class FileService {
  constructor() {
    this.PROJECTS_DIR = config.getProjectsDir();
  }

  async getFileContent(projectName, filePath, userId) {
    const { ProjectModel, FileModel } = getModels();

    if (config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
      const project = await ProjectModel.findOne({
        owner: userId,
        name: projectName,
      });
      if (!project) {
        throw new Error("Project not found");
      }
      const fileDoc = await FileModel.findOne({
        project: project._id,
        path: filePath,
        type: "file",
      }).lean();
      if (!fileDoc) {
        throw new Error("File not found");
      }
      return {
        content: fileDoc.content || "",
        size: fileDoc.size || 0,
        modified: fileDoc.updatedAt,
        language: getFileLanguage(filePath),
      };
    }

    const fullPath = path.join(this.PROJECTS_DIR, projectName, filePath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const content = fs.readFileSync(fullPath, "utf8");
      const stats = fs.statSync(fullPath);
      return {
        content,
        size: stats.size,
        modified: stats.mtime,
        language: getFileLanguage(filePath),
      };
    }
    throw new Error("File not found");
  }

  async saveFileContent(projectName, filePath, content, userId, io) {
    const { ProjectModel, FileModel } = getModels();

    if (config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
      const project = await ProjectModel.findOne({
        owner: userId,
        name: projectName,
      });
      if (!project) {
        throw new Error("Project not found");
      }
      const doc = await FileModel.findOneAndUpdate(
        { project: project._id, path: filePath, type: "file" },
        {
          $set: {
            content: content ?? "",
            size: Buffer.byteLength(content || ""),
          },
        },
        { new: true }
      );
      if (!doc) {
        throw new Error("File not found");
      }

      // Sync file changes to container
      try {
        const ContainerService = require("./containerService");
        const containerService = new ContainerService();
        // Note: Container sync functionality will be implemented later
        console.log(`File sync to container for project: ${projectName}`);
      } catch (syncError) {
        console.warn(`Failed to sync file to container: ${syncError.message}`);
      }

      io.to(projectName).emit("file-updated", {
        projectName,
        filePath,
        content,
      });
      // Also sync into running container ephemeral volume if present
      try {
        const ContainerService = require("./containerService");
        const containerService = new ContainerService();
        if (typeof containerService.syncFile === "function") {
          await containerService.syncFile(projectName, filePath);
        }
      } catch {}
      return { success: true, message: "File saved" };
    }

    const fullPath = path.join(this.PROJECTS_DIR, projectName, filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
    io.to(projectName).emit("file-updated", {
      projectName,
      filePath,
      content,
    });
    // No DB in this path; files are directly on disk so container sees via bind mount
    return { success: true, message: "File saved successfully" };
  }

  async createFileOrFolder(
    projectName,
    filePath,
    content = "",
    type = "file",
    userId
  ) {
    const { ProjectModel, FileModel } = getModels();

    console.log(`📁 Create ${type} request:`, {
      projectName,
      filePath,
      type,
      userId,
    });

    if (config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
      const project = await ProjectModel.findOne({
        owner: userId,
        name: projectName,
      });
      if (!project) {
        throw new Error("Project not found");
      }
      const exists = await FileModel.findOne({
        project: project._id,
        path: filePath,
      });
      if (exists) {
        throw new Error(`${type} already exists`);
      }
      await FileModel.create({
        project: project._id,
        path: filePath,
        name: filePath.split("/").pop(),
        type,
        content: type === "file" ? content : undefined,
        size: type === "file" ? Buffer.byteLength(content) : 0,
      });
      return { success: true, message: `${type} created` };
    }

    const fullPath = path.join(this.PROJECTS_DIR, projectName, filePath);
    if (type === "folder") {
      if (fs.existsSync(fullPath)) {
        throw new Error("Folder already exists");
      }
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(fullPath)) {
        throw new Error("File already exists");
      }
      fs.writeFileSync(fullPath, content, "utf8");
    }
    return { success: true, message: `${type} created successfully` };
  }

  async deleteFileOrFolder(projectName, filePath, userId) {
    const { ProjectModel, FileModel } = getModels();

    if (config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
      const project = await ProjectModel.findOne({
        owner: userId,
        name: projectName,
      });
      if (!project) {
        throw new Error("Project not found");
      }
      const doc = await FileModel.findOne({
        project: project._id,
        path: filePath,
      });
      if (!doc) {
        throw new Error("Not found");
      }
      if (doc.type === "folder") {
        const prefix = filePath.endsWith("/") ? filePath : filePath + "/";
        await FileModel.deleteMany({
          project: project._id,
          path: { $regex: `^${prefix}` },
        });
      }
      await FileModel.deleteOne({ _id: doc._id });
      return { success: true, message: "Deleted" };
    }

    const fullPath = path.join(this.PROJECTS_DIR, projectName, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error("File or folder not found");
    }
    if (fs.statSync(fullPath).isDirectory())
      fs.rmSync(fullPath, { recursive: true, force: true });
    else fs.unlinkSync(fullPath);
    return { success: true, message: "Deleted successfully" };
  }

  async renameFileOrFolder(projectName, oldPath, newName, userId) {
    const { ProjectModel, FileModel } = getModels();

    if (config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
      const project = await ProjectModel.findOne({
        owner: userId,
        name: projectName,
      });
      if (!project) {
        throw new Error("Project not found");
      }
      const target = await FileModel.findOne({
        project: project._id,
        path: oldPath,
      });
      if (!target) {
        throw new Error("File or folder not found");
      }

      const oldDir = path.posix.dirname(oldPath);
      const newPath = oldDir === "." ? newName : `${oldDir}/${newName}`;
      // Check collision
      const collision = await FileModel.findOne({
        project: project._id,
        path: newPath,
      });
      if (collision) {
        throw new Error("Destination already exists");
      }

      if (target.type === "folder") {
        // Update all descendants paths with prefix replacement
        const prefix = oldPath.endsWith("/") ? oldPath : oldPath + "/";
        const newPrefix = newPath.endsWith("/") ? newPath : newPath + "/";
        const descendants = await FileModel.find({
          project: project._id,
          path: { $regex: `^${prefix}` },
        });
        const bulk = descendants.map((doc) => ({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { path: doc.path.replace(prefix, newPrefix) } },
          },
        }));
        if (bulk.length) await FileModel.bulkWrite(bulk);
      }

      // Update target itself
      target.path = newPath;
      target.name = newName;
      await target.save();

      return { success: true, message: "Renamed successfully" };
    }

    // Filesystem fallback
    const fullOldPath = path.join(this.PROJECTS_DIR, projectName, oldPath);
    const fullNewPath = path.join(path.dirname(fullOldPath), newName);
    if (!fs.existsSync(fullOldPath)) {
      throw new Error("File or folder not found");
    }
    if (fs.existsSync(fullNewPath)) {
      throw new Error("File or folder with new name already exists");
    }
    fs.renameSync(fullOldPath, fullNewPath);
    return { success: true, message: "Renamed successfully" };
  }

  // Additional methods expected by tests
  async createFile(projectName, filePath, content = "", userId) {
    return this.saveFileContent(projectName, filePath, content, userId, {
      to: () => {}, // Mock io object
    });
  }

  async getFiles(projectName, userId) {
    const { ProjectModel, FileModel } = getModels();

    if (config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
      const project = await ProjectModel.findOne({
        owner: userId,
        name: projectName,
      });
      if (!project) {
        throw new Error("Project not found");
      }

      const files = await FileModel.find({
        project: project._id,
        type: "file",
      }).lean();

      return files.map((file) => ({
        path: file.path,
        name: file.name,
        size: file.size,
        modified: file.updatedAt,
        language: getFileLanguage(file.path),
      }));
    }

    // Filesystem approach
    const projectPath = path.join(this.PROJECTS_DIR, projectName);
    if (!fs.existsSync(projectPath)) {
      throw new Error("Project not found");
    }

    const files = [];
    const scanDirectory = (dir, relativePath = "") => {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const itemRelativePath = relativePath
          ? `${relativePath}/${item}`
          : item;

        if (fs.statSync(fullPath).isFile()) {
          const stats = fs.statSync(fullPath);
          files.push({
            path: itemRelativePath,
            name: item,
            size: stats.size,
            modified: stats.mtime,
            language: getFileLanguage(itemRelativePath),
          });
        } else if (fs.statSync(fullPath).isDirectory()) {
          scanDirectory(fullPath, itemRelativePath);
        }
      }
    };

    scanDirectory(projectPath);
    return files;
  }

  async getFile(projectName, filePath, userId) {
    if (!filePath) {
      throw new Error("File path is required");
    }
    return this.getFileContent(projectName, filePath, userId);
  }

  async updateFile(projectName, filePath, content, userId) {
    return this.saveFileContent(projectName, filePath, content, userId, {
      to: () => {}, // Mock io object
    });
  }

  async deleteFile(projectName, filePath, userId) {
    return this.deleteFileOrFolder(projectName, filePath, userId);
  }

  async getProjectTree(projectName, userId) {
    const { ProjectModel, FileModel } = getModels();

    if (config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
      const project = await ProjectModel.findOne({
        owner: userId,
        name: projectName,
      });
      if (!project) {
        throw new Error("Project not found");
      }

      const files = await FileModel.find({
        project: project._id,
      }).lean();

      // Build tree structure
      const tree = { name: projectName, type: "folder", children: [] };

      files.forEach((file) => {
        const pathParts = file.path
          .split("/")
          .filter((part) => part.length > 0);
        let current = tree;

        pathParts.forEach((part, index) => {
          let child = current.children.find((c) => c.name === part);
          if (!child) {
            child = {
              name: part,
              type: index === pathParts.length - 1 ? file.type : "folder",
              children: [],
            };
            current.children.push(child);
          }
          current = child;
        });
      });

      return tree;
    }

    // Filesystem approach
    const projectPath = path.join(this.PROJECTS_DIR, projectName);
    if (!fs.existsSync(projectPath)) {
      throw new Error("Project not found");
    }

    const buildTree = (dirPath, name = path.basename(dirPath)) => {
      const stats = fs.statSync(dirPath);

      if (stats.isFile()) {
        return {
          name,
          type: "file",
          size: stats.size,
          modified: stats.mtime,
        };
      }

      const children = [];
      const items = fs.readdirSync(dirPath);

      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        children.push(buildTree(itemPath, item));
      }

      return {
        name,
        type: "folder",
        children,
      };
    };

    return buildTree(projectPath);
  }

  // Validation method expected by tests
  validateFileData(fileData) {
    if (!fileData || !fileData.path) {
      throw new Error("File path is required");
    }
    if (fileData.path.length < 1) {
      throw new Error("File path cannot be empty");
    }
    return true;
  }
}

module.exports = new FileService();
