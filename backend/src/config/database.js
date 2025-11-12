const mongoose = require("mongoose");
const config = require("./index");

let ProjectModel = null;
let FileModel = null;
let projectTreeUtils = null;

const connectDatabase = async () => {
  try {
    if (config.MONGODB_URI) {
      await mongoose.connect(config.MONGODB_URI, {
        serverSelectionTimeoutMS: 8000,
      });
      console.log("🗄️  MongoDB connected");

      // Load models if DB projects are enabled
      if (config.USE_DB_PROJECTS_BOOL) {
        try {
          ProjectModel = require("../models/Project");
          FileModel = require("../models/File");
          projectTreeUtils = require("../utils/projectTree");
          console.log("📦  DB Project storage ENABLED");
        } catch (e) {
          console.error("Failed loading DB project models:", e.message);
        }
      } else {
        console.log("📁  Filesystem project storage (default)");
      }

      return true;
    } else {
      console.warn("⚠️  MONGODB_URI not set; auth will be in-memory only");
      console.log("📁  Filesystem project storage (default)");
      return false;
    }
  } catch (e) {
    // Log full error to help debugging (stack includes driver/error details)
    console.error("❌ MongoDB connection failed:", e && e.stack ? e.stack : e);
    console.warn("📁 Proceeding without MongoDB; DB-backed features disabled");
    return false;
  }
};

const getModels = () => {
  return {
    ProjectModel,
    FileModel,
    projectTreeUtils,
  };
};

module.exports = {
  connectDatabase,
  getModels,
};
