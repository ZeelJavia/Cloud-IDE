// Load environment variables from the backend folder explicitly.
// When the server is started from `backend/src` (or other cwd), dotenv
// may not find the `backend/.env` file. Use an explicit path so the
// configuration is consistent regardless of the current working dir.
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

// Allow configuring frontend origins via env (comma-separated)
function parseOrigins(str) {
  return String(str || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const ALLOWED_ORIGINS = parseOrigins(process.env.FRONTEND_ORIGINS);

const config = {
  // Server Configuration
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || "development",
  // Web serving (nginx) fixed host port
  WEB_PORT: Number(process.env.WEB_PORT || 8088),
  // For DB-backed projects, control whether to mirror files to backend/projects (off by default)
  MATERIALIZE_DB_TO_FS: String(
    process.env.MATERIALIZE_DB_TO_FS || "false"
  ).toLowerCase(),
  // Populate project files directly inside container volume (no local writes)
  IN_CONTAINER_DB_FETCH: String(
    process.env.IN_CONTAINER_DB_FETCH || "true"
  ).toLowerCase(),

  // Database Configuration
  MONGODB_URI: process.env.MONGODB_URI || process.env.DATABASE_URL,

  // JWT Configuration
  JWT_SECRET: process.env.JWT_SECRET || "your-jwt-secret-key",

  // CORS Configuration
  ALLOWED_ORIGINS: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : DEFAULT_ORIGINS,
  DEFAULT_ORIGINS,

  // AI Configuration
  API_KEY:
    process.env.A4F_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_API_KEY ||
    "",
  AI_MODEL: process.env.AI_MODEL || "gemini-1.5-flash",

  // Docker Configuration
  DOCKER_IMAGES:
    process.env.DOCKER_IMAGES ||
    "node:20-alpine,python:3.11-slim,gcc:12,eclipse-temurin:17-jdk",
  DOCKER_REUSE:
    String(process.env.DOCKER_REUSE || "true").toLowerCase() !== "false",
  CONTAINER_TTL_SEC: Number(process.env.CONTAINER_TTL_SEC || 600),

  // File and Project Configuration
  USE_DB_PROJECTS: String(process.env.USE_DB_PROJECTS || "").toLowerCase(),

  // Resource Limits
  MAX_RUN_HISTORY: Number(process.env.MAX_RUN_HISTORY || 100),
  STDIN_MAX_BYTES: Number(process.env.STDIN_MAX_BYTES || 1024 * 1024), // 1MB
  ARG_MAX_COUNT: Number(process.env.ARG_MAX_COUNT || 64),
  ARG_MAX_LEN: Number(process.env.ARG_MAX_LEN || 1024),
  ENV_MAX_COUNT: Number(process.env.ENV_MAX_COUNT || 64),
  ENV_VAL_MAX_LEN: Number(process.env.ENV_VAL_MAX_LEN || 2048),

  // Request Limits
  JSON_LIMIT: "50mb",
  URL_ENCODED_LIMIT: "50mb",

  // Paths
  getProjectsDir: () => {
    const path = require("path");
    return path.join(__dirname, "../../projects");
  },

  getUploadsDir: () => {
    const path = require("path");
    return path.join(__dirname, "../../uploads");
  },
};

// Auto-enable DB projects if Mongo configured and flag not set
if (!config.USE_DB_PROJECTS && config.MONGODB_URI) {
  config.USE_DB_PROJECTS = "true";
}

config.USE_DB_PROJECTS_BOOL = config.USE_DB_PROJECTS === "true";
config.MATERIALIZE_DB_TO_FS_BOOL = config.MATERIALIZE_DB_TO_FS === "true";
config.IN_CONTAINER_DB_FETCH_BOOL = config.IN_CONTAINER_DB_FETCH === "true";

module.exports = config;
