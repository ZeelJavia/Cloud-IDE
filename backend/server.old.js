// Clean consolidated server file
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const http = require("http");
const socketIo = require("socket.io");
const multer = require("multer");
const { spawn, spawnSync } = require("child_process");
const mongoose = require("mongoose");
// Import authentication routes
const { authRouter, authenticateToken } = require("./routes/auth");
const ContainerizedTerminal = require("./services/ContainerizedTerminal");

// Allow configuring frontend origins via env (comma-separated)
function parseOrigins(str) {
  return String(str || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
const DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const ALLOWED_ORIGINS = parseOrigins(process.env.FRONTEND_ORIGINS);
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowedOrigins = ALLOWED_ORIGINS.length
        ? ALLOWED_ORIGINS
        : DEFAULT_ORIGINS;
      const isAllowed = allowedOrigins.some((allowed) => {
        if (typeof allowed === "string") return allowed === origin;
        if (allowed instanceof RegExp) return allowed.test(origin);
        return false;
      });

      callback(null, isAllowed);
    },
    methods: ["GET", "POST"],
  },
});

// Socket authentication middleware (JWT via query.token or handshake.auth.token)
io.use((socket, next) => {
  try {
    const token =
      (socket.handshake.query && socket.handshake.query.token) ||
      (socket.handshake.auth && socket.handshake.auth.token);
    if (!token) return next(); // allow anonymous; HTTP routes still enforce auth
    const jwt = require("jsonwebtoken");
    const JWT_SECRET = process.env.JWT_SECRET || "your-jwt-secret-key";
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (!err && decoded)
        socket.user = { id: decoded.id, email: decoded.email };
      return next();
    });
  } catch (e) {
    return next();
  }
});

// Use a fixed default port for development to simplify frontend <-> backend wiring
// Can still be overridden via environment variable PORT
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowedOrigins = ALLOWED_ORIGINS.length
        ? ALLOWED_ORIGINS
        : DEFAULT_ORIGINS;
      // console.log(
      //   `🔍 CORS Check: Origin=${origin}, Allowed=${allowedOrigins.join(",")}`
      // );
      const isAllowed = allowedOrigins.includes(origin);
      callback(null, isAllowed);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Health check endpoint for discovery (single definition)
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Backend server is running" });
});

// Authentication routes (before other protected routes)
app.use("/api/auth", authRouter);

// AI Configuration (use environment variables; avoid hardcoding secrets)
const API_KEY =
  process.env.A4F_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.AI_API_KEY ||
  "";
const MODEL = process.env.AI_MODEL || "gemini-1.5-flash";

console.log(
  `🤖 AI Configuration: ${
    API_KEY ? "API Key configured" : "No API Key - AI features disabled"
  }`
);
const { runFile } = require("./src/runner");

// Simple upload storage
const upload = multer({ dest: path.join(__dirname, "uploads") });

// Projects directory
const PROJECTS_DIR = path.join(__dirname, "projects");
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

// --- Project Persistence Mode (Filesystem vs Mongo) ---
let USE_DB_PROJECTS = String(process.env.USE_DB_PROJECTS || "").toLowerCase();
if (!USE_DB_PROJECTS && process.env.MONGODB_URI) {
  // Auto-enable if Mongo configured and flag not set
  USE_DB_PROJECTS = "true";
}
const USE_DB_PROJECTS_BOOL = USE_DB_PROJECTS === "true";
let ProjectModel = null;
let FileModel = null;
let projectTreeUtils = null;
if (USE_DB_PROJECTS_BOOL) {
  try {
    ProjectModel = require("./models/Project");
    FileModel = require("./models/File");
    projectTreeUtils = require("./utils/projectTree");
    console.log("📦  DB Project storage ENABLED");
  } catch (e) {
    console.error("Failed loading DB project models:", e.message);
  }
} else {
  console.log("📁  Filesystem project storage (default)");
}

// Active runs per terminal
const activeRuns = new Map(); // terminalId -> { mode: 'docker'|'local', child, containerName? }

// Initialize containerized terminal service
const containerTerminal = new ContainerizedTerminal();

// Run history (recent N)
const MAX_RUN_HISTORY = Number(process.env.MAX_RUN_HISTORY || 100);
const runHistory = [];
function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function addRunHistory(entry) {
  try {
    runHistory.push(entry);
    while (runHistory.length > MAX_RUN_HISTORY) runHistory.shift();
  } catch {}
}

// Input limits
const STDIN_MAX_BYTES = Number(process.env.STDIN_MAX_BYTES || 1024 * 1024); // 1MB
const ARG_MAX_COUNT = Number(process.env.ARG_MAX_COUNT || 64);
const ARG_MAX_LEN = Number(process.env.ARG_MAX_LEN || 1024);
const ENV_MAX_COUNT = Number(process.env.ENV_MAX_COUNT || 64);
const ENV_VAL_MAX_LEN = Number(process.env.ENV_VAL_MAX_LEN || 2048);
function clampString(s, max) {
  s = String(s == null ? "" : s);
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max));
}
function sanitizeArgs(args) {
  const a = Array.isArray(args) ? args.slice(0, ARG_MAX_COUNT) : [];
  return a.map((x) => clampString(x, ARG_MAX_LEN));
}
function sanitizeEnvVars(envVars) {
  const out = {};
  const entries = Object.entries(envVars || {}).slice(0, ENV_MAX_COUNT);
  for (const [k, v] of entries) out[k] = clampString(v, ENV_VAL_MAX_LEN);
  return out;
}

// Utility: check a tool exists and get output
async function checkTool(cmd, args = ["--version"]) {
  return await new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { shell: false });
      let out = "";
      let err = "";
      p.stdout.on("data", (c) => (out += c.toString()));
      p.stderr.on("data", (c) => (err += c.toString()));
      p.on("close", (code) => {
        resolve({
          ok: code === 0,
          code,
          stdout: out.trim(),
          stderr: err.trim(),
        });
      });
      p.on("error", (e) => {
        resolve({ ok: false, code: -1, stdout: "", stderr: e.message });
      });
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: "", stderr: e.message });
    }
  });
}

// Lightweight spawn helper
function spawnWait(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { shell: false, ...opts });
      let out = "";
      let err = "";
      p.stdout?.on?.("data", (c) => (out += c.toString()));
      p.stderr?.on?.("data", (c) => (err += c.toString()));
      p.on("close", (code) => resolve({ code, stdout: out, stderr: err }));
      p.on("error", (e) =>
        resolve({ code: -1, stdout: "", stderr: e.message })
      );
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: e.message });
    }
  });
}

// Background Docker image pre-pull (optional)
async function prePullDockerImages() {
  try {
    const images = (
      process.env.DOCKER_IMAGES ||
      "node:20-alpine,python:3.11-slim,gcc:12,eclipse-temurin:17-jdk"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!images.length) return;

    const hasDocker = await spawnWait("docker", ["--version"]);
    if (hasDocker.code !== 0) {
      console.warn("⚠️ Docker not detected; skipping image pre-pull");
      return;
    }

    for (const image of images) {
      const inspect = await spawnWait("docker", ["image", "inspect", image]);
      if (inspect.code === 0) {
        console.log(`🐳 Docker image present: ${image}`);
        continue;
      }
      console.log(`🐳 Pulling docker image: ${image} ...`);
      const pull = await spawnWait("docker", ["pull", image]);
      if (pull.code === 0) {
        console.log(`✅ Pulled: ${image}`);
      } else {
        console.warn(
          `⚠️ Failed to pull ${image}: ${pull.stderr || pull.stdout}`
        );
      }
    }
  } catch (e) {
    console.warn("⚠️ prePullDockerImages error:", e.message);
  }
}

// --- Docker warm container reuse ---
const DOCKER_REUSE =
  String(process.env.DOCKER_REUSE || "true").toLowerCase() !== "false";
const CONTAINER_TTL_SEC = Number(process.env.CONTAINER_TTL_SEC || 600);
const reusePool = new Map(); // key -> { containerName, image, projectDir, limits, lastUsed }

function poolKey(image, projectDir, limits) {
  const lim = limits || {};
  return `${image}|${projectDir}|cpus=${lim.cpus}|mem=${lim.memory}|pids=${lim.pids}`;
}

async function ensureWarmContainer(image, projectDir, limits) {
  const key = poolKey(image, projectDir, limits);
  const existing = reusePool.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.containerName;
  }
  const containerName = `ide-reuse-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const argsCreate = [
    "run",
    "-dit",
    "--name",
    containerName,
    "--cpus",
    String(limits?.cpus || "1.0"),
    "--memory",
    String(limits?.memory || "512m"),
    "--pids-limit",
    String(limits?.pids || 256),
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "-v",
    `${projectDir}:/workspace`,
    "-w",
    "/workspace",
    image,
    "sh",
    "-lc",
    "sleep infinity",
  ];
  const created = await spawnWait("docker", argsCreate);
  if (created.code !== 0) {
    throw new Error(
      `Failed to create warm container: ${created.stderr || created.stdout}`
    );
  }
  reusePool.set(key, {
    containerName,
    image,
    projectDir,
    limits: { ...limits },
    lastUsed: Date.now(),
  });
  console.log(`🔥 Warm container started: ${containerName} (${image})`);
  return containerName;
}

async function cleanupWarmContainers() {
  if (!CONTAINER_TTL_SEC || CONTAINER_TTL_SEC <= 0) return;
  const now = Date.now();
  for (const [key, rec] of Array.from(reusePool.entries())) {
    if (now - rec.lastUsed > CONTAINER_TTL_SEC * 1000) {
      try {
        await spawnWait("docker", ["rm", "-f", rec.containerName]);
        console.log(`🧹 Removed stale warm container: ${rec.containerName}`);
      } catch {}
      reusePool.delete(key);
    }
  }
}
setInterval(cleanupWarmContainers, 60 * 1000).unref?.();

io.on("connection", (socket) => {
  // Join/leave a project room to broadcast file changes if needed
  socket.on("join-project", (projectName) => socket.join(projectName));
  socket.on("leave-project", (projectName) => socket.leave(projectName));

  // Initialize containerized terminal for a project
  socket.on("init-container-terminal", async (payload = {}) => {
    const { terminalId, projectName } = payload;
    const userId = (socket.user && socket.user.id) || payload?.userId;

    if (!terminalId || !projectName || !userId) {
      socket.emit("terminal-output", {
        terminalId,
        output: "Error: terminalId, projectName, and userId are required\n",
        error: true,
      });
      return;
    }

    try {
      socket.emit("terminal-output", {
        terminalId,
        output: `🐳 Initializing containerized environment for project: ${projectName}\n`,
      });

      const containerInfo = await containerTerminal.initializeTerminalSession(
        terminalId,
        projectName,
        userId
      );

      socket.emit("terminal-output", {
        terminalId,
        output: `✅ Container ready (${containerInfo.projectType})\n`,
      });

      if (containerInfo.mappedPort) {
        socket.emit("terminal-output", {
          terminalId,
          output: `🌐 Web server available at: http://localhost:${containerInfo.mappedPort}\n`,
        });
      }

      socket.emit("terminal-output", {
        terminalId,
        output: `📁 Working directory: /workspace\n\n`,
      });

      socket.emit("container-ready", {
        terminalId,
        projectName,
        containerInfo: {
          projectType: containerInfo.projectType,
          url: containerTerminal.containerManager.getContainerUrl(
            containerInfo
          ),
        },
      });
    } catch (error) {
      socket.emit("terminal-output", {
        terminalId,
        output: `❌ Failed to initialize container: ${error.message}\n`,
        error: true,
      });
    }
  });

  // Execute command in containerized terminal (new approach)
  socket.on("execute-container-command", async (payload = {}) => {
    const { terminalId, command, workingDirectory } = payload;
    const userId = (socket.user && socket.user.id) || payload?.userId;

    if (!terminalId || !command) return;

    console.log(`[DEBUG] execute-container-command received:`, {
      terminalId,
      command,
      workingDirectory,
    });

    try {
      let childProcess = null;

      const result = await containerTerminal.executeCommand(
        terminalId,
        command,
        {
          workingDirectory: workingDirectory || "/workspace",
          onStdout: (data) => {
            socket.emit("terminal-output", { terminalId, output: data });
          },
          onStderr: (data) => {
            socket.emit("terminal-output", {
              terminalId,
              output: data,
              error: true,
            });
          },
          onProcess: (child) => {
            childProcess = child;
            activeRuns.set(terminalId, { mode: "container", child });
          },
        }
      );

      activeRuns.delete(terminalId);

      // Update terminal working directory if it changed
      if (result.workingDirectory) {
        containerTerminal.updateTerminalWorkingDirectory(
          terminalId,
          result.workingDirectory
        );
      }

      socket.emit("command-completed", {
        terminalId,
        exitCode: result.code,
        workingDirectory: result.workingDirectory,
      });
    } catch (error) {
      activeRuns.delete(terminalId);
      socket.emit("terminal-output", {
        terminalId,
        output: `❌ Container command error: ${error.message}\n`,
        error: true,
      });
      socket.emit("command-completed", { terminalId, exitCode: -1 });
    }
  });

  // Start web server in container
  socket.on("start-web-server", async (data) => {
    const { terminalId, port = 8080, workingDirectory } = data || {};

    if (!terminalId) return;

    console.log(`[DEBUG] start-web-server received:`, {
      terminalId,
      port,
      workingDirectory,
    });

    try {
      // Update terminal working directory if provided
      if (workingDirectory) {
        containerTerminal.updateTerminalWorkingDirectory(
          terminalId,
          workingDirectory
        );
      }

      let childProcess = null;

      const result = await containerTerminal.startWebServer(terminalId, port, {
        onStdout: (data) => {
          socket.emit("terminal-output", { terminalId, output: data });
        },
        onStderr: (data) => {
          socket.emit("terminal-output", {
            terminalId,
            output: data,
            error: true,
          });
        },
        onProcess: (child) => {
          childProcess = child;
          activeRuns.set(terminalId, { mode: "container-web", child });
        },
      });

      // Don't delete activeRuns for web servers as they should keep running
      // activeRuns.delete(terminalId);

      socket.emit("command-completed", {
        terminalId,
        exitCode: result.code,
        url: result.url,
      });
    } catch (error) {
      activeRuns.delete(terminalId);
      socket.emit("terminal-output", {
        terminalId,
        output: `❌ Web server error: ${error.message}\n`,
        error: true,
      });
      socket.emit("command-completed", { terminalId, exitCode: -1 });
    }
  });

  // Execute ad-hoc terminal command (legacy/fallback)
  socket.on("execute-command", (payload = {}) => {
    const { terminalId, command, workingDirectory } = payload;
    if (!terminalId || !command) return;

    console.log(`[DEBUG] execute-command received:`, {
      terminalId,
      command,
      workingDirectory,
      PROJECTS_DIR,
    });

    let cwd = PROJECTS_DIR;
    try {
      if (workingDirectory && typeof workingDirectory === "string") {
        const candidate = path.isAbsolute(workingDirectory)
          ? workingDirectory
          : path.join(PROJECTS_DIR, workingDirectory);
        const resolved = path.resolve(candidate);

        console.log(`[DEBUG] Directory resolution:`, {
          candidate,
          resolved,
          projectsDir: path.resolve(PROJECTS_DIR),
          exists: fs.existsSync(resolved),
          startsWithProjects: resolved.startsWith(path.resolve(PROJECTS_DIR)),
        });

        if (
          resolved.startsWith(path.resolve(PROJECTS_DIR)) &&
          fs.existsSync(resolved)
        ) {
          cwd = resolved;
          console.log(`[DEBUG] Using cwd: ${cwd}`);
        } else {
          console.log(`[DEBUG] Using default cwd: ${cwd} (validation failed)`);
        }
      }
    } catch (e) {
      console.log(`[DEBUG] Error in directory resolution:`, e.message);
    }

    const isWin = process.platform === "win32";
    const shell = isWin ? "powershell.exe" : "/bin/bash";
    const shellArgs = isWin
      ? [
          "-NoLogo",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          command,
        ]
      : ["-lc", command];

    const child = spawn(shell, shellArgs, { cwd, env: process.env });
    activeRuns.set(terminalId, { mode: "local", child });

    child.stdout.on("data", (c) =>
      socket.emit("terminal-output", { terminalId, output: c.toString() })
    );
    child.stderr.on("data", (c) =>
      socket.emit("terminal-output", {
        terminalId,
        output: c.toString(),
        error: true,
      })
    );
    child.on("close", (code) => {
      activeRuns.delete(terminalId);

      // For directory navigation commands, get and return the new working directory
      const isDirectoryCommand =
        command.trim().toLowerCase().startsWith("cd ") ||
        command.trim().toLowerCase() === "cd";

      let currentWorkingDir = null;
      if (isDirectoryCommand) {
        try {
          // Get the current working directory after cd command
          const pwdResult = isWin
            ? spawnSync(
                "powershell.exe",
                [
                  "-NoProfile",
                  "-Command",
                  "Get-Location | Select-Object -ExpandProperty Path",
                ],
                { cwd, encoding: "utf8" }
              )
            : spawnSync("pwd", [], { cwd, encoding: "utf8" });

          if (pwdResult.status === 0 && pwdResult.stdout) {
            currentWorkingDir = pwdResult.stdout.trim();
            // Convert to relative path from PROJECTS_DIR
            const resolved = path.resolve(currentWorkingDir);
            const projectsResolved = path.resolve(PROJECTS_DIR);
            if (resolved.startsWith(projectsResolved)) {
              currentWorkingDir = path.relative(projectsResolved, resolved);
            }
          }
        } catch (e) {
          // Ignore errors in getting pwd
        }
      }

      socket.emit("command-completed", {
        terminalId,
        exitCode: code ?? 0,
        workingDirectory: currentWorkingDir,
      });
    });
    child.on("error", (err) => {
      activeRuns.delete(terminalId);
      socket.emit("terminal-output", {
        terminalId,
        output: `Failed to start process: ${err.message}\n`,
        error: true,
      });
      socket.emit("command-completed", { terminalId, exitCode: -1 });
    });
  });

  // Containerized file execution (new approach)
  socket.on("run-container-file", async (data) => {
    try {
      console.log("Run-container-file event received:", data);
      const {
        terminalId = "terminal-1",
        projectName,
        filePath,
        args = [],
        stdinText,
        envVars = {},
        workingDirectory,
      } = data || {};

      const userId = (socket.user && socket.user.id) || data?.userId;

      if (!projectName || !filePath || !userId) {
        socket.emit("terminal-output", {
          terminalId,
          output:
            "run-container-file: projectName, filePath, and userId are required\n",
          error: true,
        });
        socket.emit("command-completed", { terminalId, exitCode: -1 });
        return;
      }

      // Update terminal working directory if provided
      if (workingDirectory) {
        containerTerminal.updateTerminalWorkingDirectory(
          terminalId,
          workingDirectory
        );
      }

      socket.emit("terminal-output", {
        terminalId,
        output: `\n=== Running file: ${filePath} ===\n`,
      });

      try {
        let childProcess = null;

        const result = await containerTerminal.runFile(
          terminalId,
          filePath,
          args,
          {
            stdin: stdinText,
            env: envVars,
            onStdout: (data) => {
              socket.emit("terminal-output", { terminalId, output: data });
            },
            onStderr: (data) => {
              socket.emit("terminal-output", {
                terminalId,
                output: data,
                error: true,
              });
            },
            onProcess: (child) => {
              childProcess = child;
              activeRuns.set(terminalId, { mode: "container", child });
            },
          }
        );

        activeRuns.delete(terminalId);

        // If it's a web project, emit special event
        if (result.url) {
          socket.emit("web-project-ready", {
            terminalId,
            url: result.url,
            filePath,
          });
        }

        socket.emit("command-completed", {
          terminalId,
          exitCode: result.code,
          url: result.url,
        });
      } catch (error) {
        activeRuns.delete(terminalId);
        socket.emit("terminal-output", {
          terminalId,
          output: `❌ Container execution error: ${error.message}\n`,
          error: true,
        });
        socket.emit("command-completed", { terminalId, exitCode: -1 });
      }
    } catch (err) {
      socket.emit("terminal-output", {
        terminalId: data?.terminalId,
        output: `Server error: ${err.message}\n`,
        error: true,
      });
      socket.emit("command-completed", {
        terminalId: data?.terminalId,
        exitCode: -1,
      });
    }
  });

  // Program run with streaming over sockets; supports Docker isolation (legacy)
  socket.on("run-file", async (data) => {
    try {
      console.log("Run-file event received:", data);
      const {
        terminalId = "terminal-1", // Use default terminalId if not provided
        projectName,
        filePath,
        args = [],
        stdinText,
        useDocker = true,
        timeoutSec = 30,
        envVars = {},
        limits = { cpus: "1.0", memory: "512m", pids: 256 },
      } = data || {};

      console.log(
        `Processing run-file: project=${projectName}, file=${filePath}, terminalId=${terminalId}`
      );

      if (!projectName || !filePath) {
        console.log("Error: Missing projectName or filePath");
        socket.emit("terminal-output", {
          terminalId,
          output: "run-file: projectName and filePath are required\n",
          error: true,
        });
        socket.emit("command-completed", { terminalId, exitCode: -1 });
        return;
      }

      // Send initial feedback to terminal
      console.log(`Sending run-file output to terminal: ${terminalId}`);
      socket.emit("terminal-output", {
        terminalId,
        output: `\n=== Running file: ${filePath} ===\n`,
      });

      // Send a separate notification to ensure terminal is getting messages
      setTimeout(() => {
        socket.emit("terminal-output", {
          terminalId,
          output: `\n=== Preparing execution environment ===\n\n`,
        });
      }, 100);
      // sanitize filePath to avoid traversal and normalize separators
      let sanitizedFilePath = String(filePath).replace(/\\/g, "/");
      if (sanitizedFilePath.startsWith("/"))
        sanitizedFilePath = sanitizedFilePath.slice(1);
      if (sanitizedFilePath.includes("..")) {
        socket.emit("terminal-output", {
          terminalId,
          output: "run-file: invalid filePath\n",
          error: true,
        });
        socket.emit("command-completed", { terminalId, exitCode: -1 });
        return;
      }
      // Determine working directory for run
      // In DB mode, we will materialize into a temporary directory per run to avoid persistent local writes.
      // In FS mode, we use the project path as before.
      let projectDir = path.join(PROJECTS_DIR, projectName);
      let ephemeralDir = null;
      if (USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
        try {
          const ownerId = (socket.user && socket.user.id) || data?.userId;
          const query = { name: projectName };
          if (ownerId) query.owner = ownerId;
          const proj = await ProjectModel.findOne(query).lean();
          if (!proj) {
            socket.emit("terminal-output", {
              terminalId,
              output: `Project not found: ${projectName}\n`,
              error: true,
            });
            socket.emit("command-completed", { terminalId, exitCode: -1 });
            return;
          }
          // Create temp dir and materialize only required file path (and parents) for execution
          const os = require("os");
          const tmpBase = fs.mkdtempSync(
            path.join(os.tmpdir(), `ide-${projectName}-`)
          );
          ephemeralDir = tmpBase;
          projectDir = ephemeralDir;
          // Fetch the one file to run from DB and write it in temp dir
          const dbFile = await FileModel.findOne({
            project: proj._id,
            path: sanitizedFilePath,
            type: "file",
          }).lean();
          if (!dbFile) {
            socket.emit("terminal-output", {
              terminalId,
              output: `File not found in project: ${sanitizedFilePath}\n`,
              error: true,
            });
            socket.emit("command-completed", { terminalId, exitCode: -1 });
            try {
              fs.rmSync(ephemeralDir, { recursive: true, force: true });
            } catch {}
            return;
          }
          const diskTarget = path.join(projectDir, sanitizedFilePath);
          const diskDir = path.dirname(diskTarget);
          fs.mkdirSync(diskDir, { recursive: true });
          fs.writeFileSync(diskTarget, dbFile.content || "", "utf8");
        } catch (e) {
          socket.emit("terminal-output", {
            terminalId,
            output: `Failed to prepare temp run directory: ${e.message}\n`,
            error: true,
          });
          socket.emit("command-completed", { terminalId, exitCode: -1 });
          return;
        }
      } else {
        // Filesystem mode: ensure project exists on disk
        if (!fs.existsSync(projectDir)) {
          socket.emit("terminal-output", {
            terminalId,
            output: `Project not found: ${projectName}\n`,
            error: true,
          });
          socket.emit("command-completed", { terminalId, exitCode: -1 });
          return;
        }
      }

      const ext = path.extname(filePath).toLowerCase();
      const runId = genId();
      const startTime = Date.now();
      let collectedOut = "";
      let collectedErr = "";

      // Apply input limits
      const cleanArgs = sanitizeArgs(args);
      const cleanEnv = sanitizeEnvVars(envVars);
      let stdinPayload = stdinText != null ? String(stdinText) : undefined;
      if (
        stdinPayload &&
        Buffer.byteLength(stdinPayload, "utf8") > STDIN_MAX_BYTES
      ) {
        stdinPayload = stdinPayload.slice(0, STDIN_MAX_BYTES);
        socket.emit("terminal-output", {
          terminalId,
          output: `Warning: stdin truncated to ${STDIN_MAX_BYTES} bytes.\n`,
          error: true,
        });
      }

      // Helper to spawn and stream output
      const runAndStream = (cmd, cmdArgs, opts = {}) => {
        const { killTimerMs, stdinText, onBeforeKillMessage, onStart } = opts;
        return new Promise((resolve) => {
          let killedByTimeout = false;
          const child = spawn(cmd, cmdArgs, { shell: false });
          if (onStart) {
            try {
              onStart(child);
            } catch {}
          }
          let timer = null;
          if (killTimerMs && killTimerMs > 0) {
            timer = setTimeout(() => {
              killedByTimeout = true;
              if (onBeforeKillMessage) {
                socket.emit("terminal-output", {
                  terminalId,
                  output: onBeforeKillMessage + "\n",
                  error: true,
                });
              }
              try {
                child.kill("SIGKILL");
              } catch {}
            }, killTimerMs);
          }
          child.stdout.on("data", (chunk) => {
            socket.emit("terminal-output", {
              terminalId,
              output: chunk.toString(),
            });
            collectedOut += chunk.toString();
          });
          child.stderr.on("data", (chunk) => {
            socket.emit("terminal-output", {
              terminalId,
              output: chunk.toString(),
              error: true,
            });
            collectedErr += chunk.toString();
          });
          if (stdinText != null) {
            try {
              child.stdin.write(String(stdinText));
            } catch {}
            try {
              child.stdin.end();
            } catch {}
          }
          child.on("close", (code) => {
            if (timer) clearTimeout(timer);
            resolve(code != null ? code : killedByTimeout ? -2 : -1);
          });
          child.on("error", (err) => {
            if (timer) clearTimeout(timer);
            socket.emit("terminal-output", {
              terminalId,
              output: `Failed to start process: ${err.message}\n`,
              error: true,
            });
            resolve(-1);
          });
        });
      };

      // Docker helpers
      const dockerImageExists = async (imageName) => {
        return await new Promise((resolve) => {
          const p = spawn("docker", ["image", "inspect", imageName], {
            shell: false,
          });
          p.on("close", (code) => resolve(code === 0));
          p.on("error", () => resolve(false));
        });
      };
      const dockerPullImage = async (imageName) => {
        socket.emit("terminal-output", {
          terminalId,
          output: `Pulling docker image: ${imageName} (this may take a while on first use)\n`,
          error: false,
        });
        return await runAndStream("docker", ["pull", imageName], {
          killTimerMs: 10 * 60 * 1000,
        });
      };

      let dockerOk = false;
      if (useDocker) {
        dockerOk = await new Promise((resolve) => {
          const dc = spawn("docker", ["--version"], { shell: false });
          dc.on("close", (code) => resolve(code === 0));
          dc.on("error", () => resolve(false));
        });
        if (!dockerOk) {
          socket.emit("terminal-output", {
            terminalId,
            output: "Docker not available. Falling back to local runner...\n",
            error: true,
          });
        }
      }

      if (useDocker && dockerOk) {
        let image = null;
        let runCmd = null;
        const fileSh = sanitizedFilePath.replace(/\\/g, "/");
        const argLine = (Array.isArray(cleanArgs) ? cleanArgs : [])
          .map((a) => `'${String(a).replace(/'/g, "'\\''")}'`)
          .join(" ");
        switch (ext) {
          case ".js":
          case ".jsx":
            image = "node:20-alpine";
            runCmd = `node ${fileSh} ${argLine}`.trim();
            break;
          case ".py":
            image = "python:3.11-slim";
            runCmd = `python ${fileSh} ${argLine}`.trim();
            break;
          case ".c": {
            image = "gcc:12";
            const out = "a.out";
            runCmd = `gcc ${fileSh} -O2 -o ${out} && ./${out} ${argLine}`;
            break;
          }
          case ".cpp": {
            image = "gcc:12";
            const out = "a.out";
            runCmd = `g++ ${fileSh} -std=c++17 -O2 -o ${out} && ./${out} ${argLine}`;
            break;
          }
          case ".java": {
            image = "eclipse-temurin:17-jdk";
            const base = path.basename(fileSh, ".java");
            runCmd = `javac ${fileSh} && java ${base} ${argLine}`;
            break;
          }
          default:
            image = null;
        }

        if (image && runCmd) {
          // Ensure image present
          const hasImg = await dockerImageExists(image);
          if (!hasImg) {
            const pullExit = await dockerPullImage(image);
            if (pullExit !== 0) {
              socket.emit("command-completed", {
                terminalId,
                exitCode: pullExit,
              });
              return;
            }
          }

          // Try warm container reuse
          let reused = false;
          let containerName = null;
          if (DOCKER_REUSE) {
            try {
              containerName = await ensureWarmContainer(
                image,
                projectDir,
                limits
              );
              reused = true;
            } catch (e) {
              // Fall back silently
            }
          }

          if (reused && containerName) {
            const execArgs = [
              "exec",
              "-i",
              ...Object.entries(cleanEnv || {}).flatMap(([k, v]) => [
                "-e",
                `${k}=${v}`,
              ]),
              containerName,
              "sh",
              "-lc",
              runCmd,
            ];
            const exit = await runAndStream("docker", execArgs, {
              killTimerMs: (timeoutSec || 60) * 1000,
              stdinText: stdinPayload,
              onBeforeKillMessage: "Run timed out; process was terminated",
              onStart: (child) => {
                activeRuns.set(terminalId, {
                  mode: "docker",
                  child,
                  containerName,
                });
              },
            });
            activeRuns.delete(terminalId);
            socket.emit("command-completed", { terminalId, exitCode: exit });
            // Cleanup ephemeral directory if used
            if (ephemeralDir) {
              try {
                fs.rmSync(ephemeralDir, { recursive: true, force: true });
              } catch {}
            }
            addRunHistory({
              id: runId,
              ts: new Date().toISOString(),
              durationMs: Date.now() - startTime,
              projectName,
              filePath: sanitizedFilePath,
              args: cleanArgs,
              env: Object.keys(cleanEnv),
              via: "warm-docker",
              exitCode: exit,
              stdout: collectedOut,
              stderr: collectedErr,
            });
            return;
          }

          // Cold run container path
          containerName = `ide-${terminalId}-${Date.now().toString(36)}`;
          const argsDocker = [
            "run",
            "--rm",
            "-i",
            "--name",
            containerName,
            "--cpus",
            String(limits?.cpus || "1.0"),
            "--memory",
            String(limits?.memory || "512m"),
            "--pids-limit",
            String(limits?.pids || 256),
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "-v",
            `${projectDir}:/workspace`,
            "-w",
            "/workspace",
            ...Object.entries(cleanEnv || {}).flatMap(([k, v]) => [
              "-e",
              `${k}=${v}`,
            ]),
            image,
            "sh",
            "-lc",
            runCmd,
          ];
          const exit = await runAndStream("docker", argsDocker, {
            killTimerMs: (timeoutSec || 60) * 1000,
            stdinText: stdinPayload,
            onBeforeKillMessage: "Run timed out; process was terminated",
            onStart: (child) => {
              activeRuns.set(terminalId, {
                mode: "docker",
                child,
                containerName,
              });
            },
          });
          activeRuns.delete(terminalId);
          socket.emit("command-completed", { terminalId, exitCode: exit });
          if (ephemeralDir) {
            try {
              fs.rmSync(ephemeralDir, { recursive: true, force: true });
            } catch {}
          }
          addRunHistory({
            id: runId,
            ts: new Date().toISOString(),
            durationMs: Date.now() - startTime,
            projectName,
            filePath: sanitizedFilePath,
            args: cleanArgs,
            env: Object.keys(cleanEnv),
            via: "docker",
            exitCode: exit,
            stdout: collectedOut,
            stderr: collectedErr,
          });
          return;
        } else {
          socket.emit("terminal-output", {
            terminalId,
            output: `No Docker runner for extension ${ext}. Falling back to local runner...\n`,
            error: true,
          });
        }
      }

      // Fallback to local runner
      const result = await runFile(
        projectDir,
        sanitizedFilePath,
        Array.isArray(cleanArgs) ? cleanArgs : [],
        timeoutSec || 20,
        stdinPayload
      );
      if (result.stdout) {
        socket.emit("terminal-output", { terminalId, output: result.stdout });
      }
      if (result.stderr) {
        socket.emit("terminal-output", {
          terminalId,
          output: result.stderr,
          error: true,
        });
      }
      socket.emit("command-completed", {
        terminalId,
        exitCode: result.exitCode ?? 0,
      });
      if (ephemeralDir) {
        try {
          fs.rmSync(ephemeralDir, { recursive: true, force: true });
        } catch {}
      }
      addRunHistory({
        id: runId,
        ts: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        projectName,
        filePath: sanitizedFilePath,
        args: cleanArgs,
        env: Object.keys(cleanEnv),
        via: "local",
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
      });
    } catch (err) {
      socket.emit("terminal-output", {
        terminalId: data?.terminalId,
        output: `Server error: ${err.message}\n`,
        error: true,
      });
      socket.emit("command-completed", {
        terminalId: data?.terminalId,
        exitCode: -1,
      });
    }
  });

  // Stop/kill current run for a terminal
  socket.on("run-stop", async (payload) => {
    try {
      const terminalId = payload?.terminalId;
      if (!terminalId) return;
      const rec = activeRuns.get(terminalId);
      if (!rec) {
        socket.emit("terminal-output", {
          terminalId,
          output: "No active run to stop.\n",
          error: true,
        });
        return;
      }
      // Try child kill first
      try {
        rec.child?.kill?.("SIGKILL");
      } catch {}
      // If docker container, for cold-run containers kill the container;
      // for warm containers (in reusePool), do NOT kill the container, only the exec process above.
      if (rec.mode === "docker" && rec.containerName) {
        const isWarm = Array.from(reusePool.values()).some(
          (r) => r.containerName === rec.containerName
        );
        if (!isWarm) {
          await new Promise((resolve) => {
            const k = spawn("docker", ["kill", rec.containerName], {
              shell: false,
            });
            k.on("close", () => resolve());
            k.on("error", () => resolve());
          });
        }
      }
      activeRuns.delete(terminalId);
      socket.emit("terminal-output", {
        terminalId,
        output: "Stop requested.\n",
        error: false,
      });
      socket.emit("command-completed", { terminalId, exitCode: -2 });
    } catch (e) {
      socket.emit("terminal-output", {
        terminalId: payload?.terminalId,
        output: `Failed to stop: ${e.message}\n`,
        error: true,
      });
    }
  });

  // Handle socket disconnect - cleanup containers and terminal sessions
  socket.on("disconnect", async (reason) => {
    console.log(`Socket disconnected: ${socket.id}, reason: ${reason}`);

    try {
      // Get user's terminal sessions and containers
      const userId = socket.user?.id; // Get userId from authenticated socket

      if (userId) {
        // Stop all terminal sessions for this user
        const userTerminals = containerTerminal.getUserTerminalSessions(userId);
        console.log(
          `Cleaning up ${userTerminals.length} terminal sessions for user ${userId}`
        );

        for (const terminalId of userTerminals) {
          await containerTerminal.stopTerminalSession(terminalId);
        }

        // Stop all containers for this user
        const userContainers = containerTerminal.getUserContainers(userId);
        console.log(
          `Cleaning up ${userContainers.length} containers for user ${userId}`
        );

        for (const container of userContainers) {
          await containerTerminal.containerManager.stopContainer(
            container.containerId
          );
        }

        console.log(`Cleanup completed for user ${userId}`);
      }
    } catch (error) {
      console.error("Error during socket disconnect cleanup:", error);
    }
  });

  // Handle project close - cleanup containers for specific project
  socket.on("close-project", async (data) => {
    try {
      const { projectName, userId } = data;
      console.log(`Closing project: ${projectName} for user: ${userId}`);

      if (projectName && userId) {
        // Find and stop containers for this project
        const projectContainers = containerTerminal.getProjectContainers(
          projectName,
          userId
        );
        console.log(
          `Stopping ${projectContainers.length} containers for project ${projectName}`
        );

        for (const container of projectContainers) {
          await containerTerminal.containerManager.stopContainer(
            container.containerId
          );
        }

        // Stop terminal sessions for this project
        const projectTerminals = containerTerminal.getProjectTerminalSessions(
          projectName,
          userId
        );
        for (const terminalId of projectTerminals) {
          await containerTerminal.stopTerminalSession(terminalId);
        }

        socket.emit("project-closed", {
          projectName,
          message: `Project ${projectName} closed and containers cleaned up`,
        });
      }
    } catch (error) {
      console.error("Error during project close cleanup:", error);
      socket.emit("project-close-error", {
        projectName: data?.projectName,
        error: error.message,
      });
    }
  });

  // Handle terminal close - cleanup specific terminal and its container
  socket.on("close-terminal", async (data) => {
    try {
      const { terminalId, userId } = data;
      console.log(`Closing terminal: ${terminalId} for user: ${userId}`);

      if (terminalId) {
        // Stop the specific terminal session
        await containerTerminal.stopTerminalSession(terminalId);

        // Check if this was the last terminal using the container
        const session = containerTerminal.getTerminalSession(terminalId);
        if (session?.containerInfo) {
          const containerInUse = containerTerminal.isContainerInUse(
            session.containerInfo.containerId
          );

          if (!containerInUse) {
            console.log(
              `No more terminals using container, stopping: ${session.containerInfo.containerId}`
            );
            await containerTerminal.containerManager.stopContainer(
              session.containerInfo.containerId
            );
          }
        }

        socket.emit("terminal-closed", {
          terminalId,
          message: `Terminal ${terminalId} closed and cleaned up`,
        });
      }
    } catch (error) {
      console.error("Error during terminal close cleanup:", error);
      socket.emit("terminal-close-error", {
        terminalId: data?.terminalId,
        error: error.message,
      });
    }
  });
});

// API Routes

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "DevDock Backend is running" });
});

// Container management endpoints
app.get("/api/containers", authenticateToken, async (req, res) => {
  try {
    const containers = containerTerminal.getUserContainers(req.user.id);
    res.json({ containers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  "/api/containers/:projectName/sync",
  authenticateToken,
  async (req, res) => {
    try {
      const { projectName } = req.params;
      await containerTerminal.syncProjectFiles(projectName, req.user.id);
      res.json({ success: true, message: "Project files synced to container" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Run history APIs
app.get("/api/runs", (req, res) => {
  const { project } = req.query;
  const items = project
    ? runHistory.filter((r) => r.projectName === project)
    : runHistory;
  // Hide large fields in list by default
  const lite = items.map((r) => ({
    id: r.id,
    ts: r.ts,
    durationMs: r.durationMs,
    projectName: r.projectName,
    filePath: r.filePath,
    args: r.args,
    env: r.env,
    via: r.via,
    exitCode: r.exitCode,
    stdoutBytes: Buffer.byteLength(r.stdout || ""),
    stderrBytes: Buffer.byteLength(r.stderr || ""),
  }));
  res.json({ runs: lite });
});

app.get("/api/runs/:id", (req, res) => {
  const item = runHistory.find((r) => r.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

app.delete("/api/runs", (req, res) => {
  runHistory.length = 0;
  res.json({ success: true });
});

// Get all projects
app.get("/api/projects", authenticateToken, async (req, res) => {
  try {
    if (USE_DB_PROJECTS_BOOL && ProjectModel) {
      const docs = await ProjectModel.find({ owner: req.user.id })
        .select("name")
        .lean();
      return res.json(docs.map((d) => d.name));
    }
    const projects = fs
      .readdirSync(PROJECTS_DIR)
      .filter((item) =>
        fs.statSync(path.join(PROJECTS_DIR, item)).isDirectory()
      );
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new project
app.post("/api/projects", authenticateToken, async (req, res) => {
  const { name: projectName } = req.body || {};
  if (!projectName)
    return res.status(400).json({ error: "Project name required" });
  try {
    if (USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
      const exists = await ProjectModel.findOne({
        owner: req.user.id,
        name: projectName,
      });
      if (exists)
        return res.status(409).json({ error: "Project already exists" });
      const project = await ProjectModel.create({
        owner: req.user.id,
        name: projectName,
      });
      // Create empty project without default files
      return res.json({
        success: true,
        message: "Project created",
        id: project._id,
      });
    }
    const projectPath = path.join(PROJECTS_DIR, projectName);
    if (fs.existsSync(projectPath))
      return res.status(409).json({ error: "Project already exists" });
    fs.mkdirSync(projectPath, { recursive: true });
    // Create empty project directory without default files
    res.json({ success: true, message: "Project created successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete project
app.delete(
  "/api/projects/:projectName",
  authenticateToken,
  async (req, res) => {
    const { projectName } = req.params;
    try {
      if (USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
        const project = await ProjectModel.findOne({
          owner: req.user.id,
          name: projectName,
        });
        if (!project)
          return res.status(404).json({ error: "Project not found" });

        // Delete all files in the project
        await FileModel.deleteMany({ project: project._id });

        // Delete the project
        await ProjectModel.deleteOne({ _id: project._id });

        return res.json({
          success: true,
          message: "Project deleted successfully",
        });
      }

      // Filesystem approach
      const projectPath = path.join(PROJECTS_DIR, projectName);
      if (!fs.existsSync(projectPath))
        return res.status(404).json({ error: "Project not found" });

      // Remove the entire project directory
      fs.rmSync(projectPath, { recursive: true, force: true });

      res.json({ success: true, message: "Project deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Get project file structure
app.get(
  "/api/projects/:projectName/files",
  authenticateToken,
  async (req, res) => {
    const { projectName } = req.params;
    try {
      if (USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
        const project = await ProjectModel.findOne({
          owner: req.user.id,
          name: projectName,
        });
        if (!project)
          return res.status(404).json({ error: "Project not found" });
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

        // Debug logging
        console.log(
          "Files from database (after dedup):",
          JSON.stringify(
            uniqueFiles.map((f) => ({
              name: f.name,
              path: f.path,
              type: f.type,
            })),
            null,
            2
          )
        );

        const tree = projectTreeUtils.buildTree(uniqueFiles);

        console.log("Built tree:", JSON.stringify(tree, null, 2));

        return res.json(tree);
      }
      const projectPath = path.join(PROJECTS_DIR, projectName);
      if (!fs.existsSync(projectPath))
        return res.status(404).json({ error: "Project not found" });
      const files = getDirectoryTree(projectPath);
      res.json(files);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Get file content
app.get(
  "/api/projects/:projectName/files/*",
  authenticateToken,
  async (req, res) => {
    const { projectName } = req.params;
    const filePath = req.params[0];
    try {
      if (USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
        const project = await ProjectModel.findOne({
          owner: req.user.id,
          name: projectName,
        });
        if (!project)
          return res.status(404).json({ error: "Project not found" });
        const fileDoc = await FileModel.findOne({
          project: project._id,
          path: filePath,
          type: "file",
        }).lean();
        if (!fileDoc) return res.status(404).json({ error: "File not found" });
        return res.json({
          content: fileDoc.content || "",
          size: fileDoc.size || 0,
          modified: fileDoc.updatedAt,
          language: getFileLanguage(filePath),
        });
      }
      const fullPath = path.join(PROJECTS_DIR, projectName, filePath);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const content = fs.readFileSync(fullPath, "utf8");
        const stats = fs.statSync(fullPath);
        return res.json({
          content,
          size: stats.size,
          modified: stats.mtime,
          language: getFileLanguage(filePath),
        });
      }
      res.status(404).json({ error: "File not found" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Save file content
app.put(
  "/api/projects/:projectName/files/*",
  authenticateToken,
  async (req, res) => {
    const { projectName } = req.params;
    const filePath = req.params[0];
    const { content } = req.body || {};
    try {
      if (USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
        const project = await ProjectModel.findOne({
          owner: req.user.id,
          name: projectName,
        });
        if (!project)
          return res.status(404).json({ error: "Project not found" });
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
        if (!doc) return res.status(404).json({ error: "File not found" });

        // Sync file changes to container
        try {
          await containerTerminal.syncProjectFiles(projectName, req.user.id);
        } catch (syncError) {
          console.warn(
            `Failed to sync file to container: ${syncError.message}`
          );
        }

        io.to(projectName).emit("file-updated", {
          projectName,
          filePath,
          content,
        });
        return res.json({ success: true, message: "File saved" });
      }
      const fullPath = path.join(PROJECTS_DIR, projectName, filePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
      io.to(projectName).emit("file-updated", {
        projectName,
        filePath,
        content,
      });
      res.json({ success: true, message: "File saved successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Create new file or folder
app.post(
  "/api/projects/:projectName/files",
  authenticateToken,
  async (req, res) => {
    const { projectName } = req.params;
    const { filePath, content = "", type = "file" } = req.body || {};
    console.log(`📁 Create ${type} request:`, {
      projectName,
      filePath,
      type,
      userId: req.user?.id,
    });
    if (!filePath) return res.status(400).json({ error: "filePath required" });
    try {
      if (USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
        const project = await ProjectModel.findOne({
          owner: req.user.id,
          name: projectName,
        });
        if (!project)
          return res.status(404).json({ error: "Project not found" });
        const exists = await FileModel.findOne({
          project: project._id,
          path: filePath,
        });
        if (exists)
          return res.status(409).json({ error: `${type} already exists` });
        await FileModel.create({
          project: project._id,
          path: filePath,
          name: filePath.split("/").pop(),
          type,
          content: type === "file" ? content : undefined,
          size: type === "file" ? Buffer.byteLength(content) : 0,
        });
        return res.json({ success: true, message: `${type} created` });
      }
      const fullPath = path.join(PROJECTS_DIR, projectName, filePath);
      if (type === "folder") {
        if (fs.existsSync(fullPath))
          return res.status(409).json({ error: "Folder already exists" });
        fs.mkdirSync(fullPath, { recursive: true });
      } else {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(fullPath))
          return res.status(409).json({ error: "File already exists" });
        fs.writeFileSync(fullPath, content, "utf8");
      }
      res.json({ success: true, message: `${type} created successfully` });
    } catch (error) {
      console.error(`❌ Error creating ${type}:`, error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Delete file or folder
app.delete(
  "/api/projects/:projectName/files/*",
  authenticateToken,
  async (req, res) => {
    const { projectName } = req.params;
    const filePath = req.params[0];
    try {
      if (USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
        const project = await ProjectModel.findOne({
          owner: req.user.id,
          name: projectName,
        });
        if (!project)
          return res.status(404).json({ error: "Project not found" });
        const doc = await FileModel.findOne({
          project: project._id,
          path: filePath,
        });
        if (!doc) return res.status(404).json({ error: "Not found" });
        if (doc.type === "folder") {
          const prefix = filePath.endsWith("/") ? filePath : filePath + "/";
          await FileModel.deleteMany({
            project: project._id,
            path: { $regex: `^${prefix}` },
          });
        }
        await FileModel.deleteOne({ _id: doc._id });
        return res.json({ success: true, message: "Deleted" });
      }
      const fullPath = path.join(PROJECTS_DIR, projectName, filePath);
      if (!fs.existsSync(fullPath))
        return res.status(404).json({ error: "File or folder not found" });
      if (fs.statSync(fullPath).isDirectory())
        fs.rmSync(fullPath, { recursive: true, force: true });
      else fs.unlinkSync(fullPath);
      res.json({ success: true, message: "Deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Rename file or folder
app.patch(
  "/api/projects/:projectName/files/*",
  authenticateToken,
  async (req, res) => {
    const { projectName } = req.params;
    const oldPath = req.params[0];
    const { newName } = req.body || {};
    if (!newName) return res.status(400).json({ error: "newName required" });

    try {
      if (USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
        const project = await ProjectModel.findOne({
          owner: req.user.id,
          name: projectName,
        });
        if (!project)
          return res.status(404).json({ error: "Project not found" });
        const target = await FileModel.findOne({
          project: project._id,
          path: oldPath,
        });
        if (!target)
          return res.status(404).json({ error: "File or folder not found" });

        const oldDir = path.posix.dirname(oldPath);
        const newPath = oldDir === "." ? newName : `${oldDir}/${newName}`;
        // Check collision
        const collision = await FileModel.findOne({
          project: project._id,
          path: newPath,
        });
        if (collision)
          return res.status(409).json({ error: "Destination already exists" });

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

        // No shadow rename in DB mode to avoid local persistence

        return res.json({ success: true, message: "Renamed successfully" });
      }

      // Filesystem fallback
      const fullOldPath = path.join(PROJECTS_DIR, projectName, oldPath);
      const fullNewPath = path.join(path.dirname(fullOldPath), newName);
      if (!fs.existsSync(fullOldPath))
        return res.status(404).json({ error: "File or folder not found" });
      if (fs.existsSync(fullNewPath))
        return res
          .status(409)
          .json({ error: "File or folder with new name already exists" });
      fs.renameSync(fullOldPath, fullNewPath);
      res.json({ success: true, message: "Renamed successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// AI Code Generation
app.post("/api/ai/generate", async (req, res) => {
  if (!API_KEY)
    return res
      .status(501)
      .json({ error: "AI is not configured. Set A4F_API_KEY in .env." });
  const { prompt, projectName } = req.body;

  try {
    const systemPrompt = `You are a helpful coding assistant. When asked to create code for a problem, respond ONLY with a valid JSON array containing objects with "filename" and "content" properties. The content should include proper file structure and complete code. Do not include any explanatory text outside the JSON. Example format:
[
  {
    "filename": "index.html",
    "content": "<!DOCTYPE html>..."
  },
  {
    "filename": "style.css", 
    "content": "body { ... }"
  }
]`;

    const fullPrompt = `${systemPrompt}\n\nUser request: ${prompt}`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        contents: [
          {
            parts: [
              {
                text: fullPrompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1500,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const responseContent = response.data.candidates[0].content.parts[0].text;

    // Clean the response
    let cleanedResponse = responseContent.trim();
    if (cleanedResponse.startsWith("```json")) {
      cleanedResponse = cleanedResponse.replace(/^```json\s*/, "");
    } else if (cleanedResponse.startsWith("```")) {
      cleanedResponse = cleanedResponse.replace(/^```\s*/, "");
    }

    if (cleanedResponse.includes("```")) {
      cleanedResponse = cleanedResponse.split("```")[0];
    }

    cleanedResponse = cleanedResponse.replace(/["'`]*\s*$/, "").trim();

    const files = JSON.parse(cleanedResponse);

    // Optionally save generated files to project
    if (projectName && req.body.saveToProject) {
      const projectPath = path.join(PROJECTS_DIR, projectName);
      if (!fs.existsSync(projectPath)) {
        fs.mkdirSync(projectPath, { recursive: true });
      }

      files.forEach((file) => {
        const fpath = path.join(projectPath, file.filename);
        const dir = path.dirname(fpath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fpath, file.content, "utf8");
      });
    }

    res.json({
      files,
      rawResponse: responseContent,
      message: "Code generated successfully",
    });
  } catch (error) {
    console.error("AI Generation Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// AI Chat
app.post("/api/ai/chat", async (req, res) => {
  if (!API_KEY) {
    return res.json({
      response:
        "🤖 AI Assistant: Hi! I'm ready to help you with coding questions. However, to provide real AI responses, you need to:\n\n1. Configure your A4F API key in the .env file as A4F_API_KEY=your-actual-key\n2. Restart the server\n\nOnce configured, I can help with code analysis, debugging, and development questions!",
    });
  }
  const { message, history = [], context } = req.body;

  try {
    // Convert messages to Gemini format
    const systemPrompt = `You are a helpful AI assistant specialized in coding and development. You're integrated into a web-based IDE similar to VS Code. You can help with:
        - Writing and debugging code
        - Explaining programming concepts
        - Suggesting best practices
        - Code optimization
        - Architecture advice
        - Framework-specific guidance
        
        ${context ? `Current context: ${context}` : ""}
        
        Provide clear, concise answers and code examples when appropriate.`;

    const conversationHistory = history
      .slice(-10)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");
    const fullPrompt = `${systemPrompt}\n\nConversation history:\n${conversationHistory}\n\nUser: ${message}\n\nAssistant:`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        contents: [
          {
            parts: [
              {
                text: fullPrompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const aiResponse = response.data.candidates[0].content.parts[0].text;
    res.json({
      response: aiResponse,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("AI Chat Error:", error.response?.data || error.message);
    res.json({
      response:
        "🤖 AI Assistant: I'm having trouble connecting to the AI service right now. Please try again in a moment.",
      timestamp: new Date().toISOString(),
    });
  }
});

// Code analysis and suggestions
app.post("/api/ai/analyze", async (req, res) => {
  if (!API_KEY)
    return res
      .status(501)
      .json({ error: "AI is not configured. Set A4F_API_KEY in .env." });
  const { code, language, fileName } = req.body;

  try {
    const systemPrompt =
      "You are a code analysis expert. Analyze the provided code and give suggestions for improvements, potential bugs, best practices, and optimizations. Be concise and specific.";
    const fullPrompt = `${systemPrompt}\n\nAnalyze this ${language} code from file "${fileName}":\n\n${code}`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        contents: [
          {
            parts: [
              {
                text: fullPrompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const analysis = response.data.candidates[0].content.parts[0].text;
    res.json({ analysis });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// File upload endpoint
app.post(
  "/api/projects/:projectName/upload",
  upload.array("files"),
  (req, res) => {
    try {
      const uploadedFiles = req.files.map((file) => ({
        name: file.filename,
        size: file.size,
        path: file.path,
      }));

      res.json({
        success: true,
        files: uploadedFiles,
        message: "Files uploaded successfully",
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// HTTP fallback: execute a single command and return collected output
app.post("/api/terminal/execute", async (req, res) => {
  try {
    const { command, workingDirectory } = req.body || {};
    if (!command || typeof command !== "string") {
      return res.status(400).json({ error: "Invalid command" });
    }

    let cwd = PROJECTS_DIR;
    try {
      if (workingDirectory && typeof workingDirectory === "string") {
        const candidate = path.isAbsolute(workingDirectory)
          ? workingDirectory
          : path.join(PROJECTS_DIR, workingDirectory);
        const resolved = path.resolve(candidate);
        if (
          resolved.startsWith(path.resolve(PROJECTS_DIR)) &&
          fs.existsSync(resolved)
        ) {
          cwd = resolved;
        }
      }
    } catch (_) {}

    const isWin = process.platform === "win32";
    const shell = isWin ? "powershell.exe" : "/bin/bash";
    const shellArgs = isWin
      ? [
          "-NoLogo",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          command,
        ]
      : ["-lc", command];

    const child = spawn(shell, shellArgs, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("close", (code) => {
      if (stderr && !stdout) {
        return res.status(200).json({ error: stderr.trim(), exitCode: code });
      }
      res.status(200).json({
        output: stdout.trim(),
        error: stderr ? stderr.trim() : undefined,
        exitCode: code,
      });
    });
    child.on("error", (err) => {
      res
        .status(500)
        .json({ error: `Failed to start process: ${err.message}` });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run a source file by extension (compile/interpret then execute)
app.post("/api/run", async (req, res) => {
  try {
    const {
      projectName,
      filePath,
      args = [],
      timeoutSec = 20,
      stdinText,
    } = req.body || {};
    if (!projectName || !filePath) {
      return res
        .status(400)
        .json({ error: "projectName and filePath are required" });
    }
    const projectDir = path.join(PROJECTS_DIR, projectName);
    if (!fs.existsSync(projectDir)) {
      return res.status(404).json({ error: "Project not found" });
    }
    const result = await runFile(
      projectDir,
      filePath,
      Array.isArray(args) ? args : [],
      timeoutSec,
      stdinText
    );
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check availability and versions of common language toolchains
app.get("/api/tools/check", async (req, res) => {
  try {
    const isWin = process.platform === "win32";
    const results = {};
    async function add(name, cmd, args) {
      results[name] = await checkTool(cmd, args);
    }
    await add("node", "node", ["-v"]);
    await add("npm", "npm", ["-v"]);
    await add("python", "python", ["--version"]);
    await add("g++", "g++", ["--version"]);
    await add("gcc", "gcc", ["--version"]);
    await add("javac", "javac", ["-version"]);
    await add("java", "java", ["-version"]);
    await add("go", "go", ["version"]);
    await add("rustc", "rustc", ["--version"]);
    await add("php", "php", ["-v"]);
    await add("ruby", "ruby", ["-v"]);
    await add("swift", "swift", ["--version"]);
    await add("kotlinc", "kotlinc", ["-version"]);
    await add("scala", "scala", ["-version"]);
    await add("docker", "docker", ["--version"]);
    if (isWin) {
      results["powershell"] = await checkTool("powershell.exe", [
        "-NoProfile",
        "-Command",
        "$PSVersionTable.PSVersion.ToString()",
      ]);
    } else {
      await add("bash", "bash", ["--version"]);
    }
    res.json({ tools: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper functions
function getDirectoryTree(dirPath, basePath = "") {
  const items = [];

  try {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const relativePath = path.join(basePath, file);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        items.push({
          name: file,
          type: "folder",
          path: relativePath.replace(/\\/g, "/"),
          children: getDirectoryTree(fullPath, relativePath),
          size: 0,
          modified: stats.mtime,
        });
      } else {
        items.push({
          name: file,
          type: "file",
          path: relativePath.replace(/\\/g, "/"),
          size: stats.size,
          modified: stats.mtime,
          extension: path.extname(file),
          language: getFileLanguage(file),
        });
      }
    }
  } catch (error) {
    console.error("Error reading directory:", error);
  }

  return items.sort((a, b) => {
    // Folders first, then files
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function getFileLanguage(filename) {
  const ext = path.extname(filename).toLowerCase();
  const languageMap = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".sass": "sass",
    ".less": "less",
    ".py": "python",
    ".java": "java",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "c",
    ".php": "php",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
    ".md": "markdown",
    ".json": "json",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".sql": "sql",
    ".sh": "shell",
    ".bash": "shell",
    ".ps1": "powershell",
    ".dockerfile": "dockerfile",
    ".gitignore": "text",
    ".env": "text",
  };

  return languageMap[ext] || "text";
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Error:", error);
  res.status(500).json({
    error: "Internal server error",
    message: error.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

async function start() {
  try {
    if (MONGODB_URI) {
      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 8000,
      });
      console.log("🗄️  MongoDB connected");
    } else {
      console.warn("⚠️  MONGODB_URI not set; auth will be in-memory only");
    }
  } catch (e) {
    console.error("❌ MongoDB connection failed:", e.message);
    // Continue without DB: auth will use in-memory users, projects use filesystem
    console.warn("📁 Proceeding without MongoDB; DB-backed features disabled");
  }

  server.listen(PORT, () => {
    const actualPort = server.address().port;
    console.log(
      `🚀 DevDock Backend Server running on http://localhost:${actualPort}`
    );
    console.log(`📁 Projects directory: ${PROJECTS_DIR}`);
    console.log(`🤖 AI Model: ${MODEL}`);

    // Write port info for frontend discovery
    const fs = require("fs");
    const portInfo = {
      port: actualPort,
      url: `http://localhost:${actualPort}`,
      timestamp: new Date().toISOString(),
    };
    // Always write to backend folder .port (frontend may fetch via dev proxy)
    const backendPortFile = path.join(__dirname, ".port");
    fs.writeFileSync(backendPortFile, JSON.stringify(portInfo, null, 2));
    // Also mirror to repo root if backend isn't the root
    try {
      const repoRootPortFile = path.join(process.cwd(), "backend", ".port");
      if (repoRootPortFile !== backendPortFile) {
        fs.writeFileSync(repoRootPortFile, JSON.stringify(portInfo, null, 2));
      }
    } catch {}
    console.log(`📡 Port info written to backend/.port for frontend discovery`);

    // Setup container cleanup interval (every 5 minutes)
    setInterval(async () => {
      try {
        await containerTerminal.cleanup();
      } catch (error) {
        console.warn(`Container cleanup error: ${error.message}`);
      }
    }, 5 * 60 * 1000);

    console.log("🐳 Containerized execution environment ready");

    // Kick off optional docker image pre-pull (non-blocking) - DISABLED FOR DEBUGGING
    // prePullDockerImages();
  });
}

start();
