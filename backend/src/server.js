// Clean consolidated modular server file
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

// Import configuration and database
const config = require("./config");
const { connectDatabase } = require("./config/database");

// Import middleware
const corsMiddleware = require("./middleware/cors");
const {
  socketAuthMiddleware,
  authenticateToken,
} = require("./middleware/auth");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

// Import routes
const { authRouter } = require("./routes/auth");
const projectRoutes = require("./routes/projects");
const fileRoutes = require("./routes/files");
const aiRoutes = require("./routes/ai");
const { getCurrentProject } = require("./utils/webServerState");
const { setCurrentProject } = require("./utils/webServerState");
const DEBUG_WEB = /^(1|true|yes)$/i.test(process.env.DEBUG_WEB || "");

// Import socket handlers
const socketHandlers = require("./socket/socketHandlers");

// Import utilities
const { checkTool } = require("./utils/validationUtils");
const { cleanupWarmContainers } = require("./utils/dockerUtils");

const app = express();
const morgan = require("morgan");
const server = http.createServer(app);

// Socket.IO setup
const io = socketIo(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowedOrigins = config.ALLOWED_ORIGINS.length
        ? config.ALLOWED_ORIGINS
        : config.DEFAULT_ORIGINS;
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

// Socket authentication middleware
io.use(socketAuthMiddleware);

// Express middleware
app.use(morgan("dev"));
app.use(corsMiddleware);
app.use(express.json({ limit: config.JSON_LIMIT }));
app.use(
  express.urlencoded({ extended: true, limit: config.URL_ENCODED_LIMIT })
);

// Make io available to controllers
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Backend server is running" });
});

// API Routes
app.use("/api/auth", authRouter);
app.use("/api/projects", projectRoutes);
// Align file routes with frontend expectations: /api/projects/:projectName/files/*
app.use("/api/projects", fileRoutes);
app.use("/api/ai", aiRoutes);

// Lightweight static web server for projects via middleware
// Serve at: /web/:projectName[/...]
function resolveProjectServeDir(projectName) {
  const root = path.join(config.getProjectsDir(), projectName);
  try {
    const dist = path.join(root, "dist");
    const pub = path.join(root, "public");
    if (fs.existsSync(path.join(dist, "index.html"))) return dist;
    if (fs.existsSync(path.join(pub, "index.html"))) return pub;
    return root;
  } catch {
    return root;
  }
}

function sendProjectAsset(req, res) {
  const { projectName } = req.params;
  const serveDir = resolveProjectServeDir(projectName);
  const rest = req.params[0] || ""; // path after projectName
  let rel = rest.replace(/^\/+/, "");
  // Default to index.html for base path or directory path
  if (!rel || rel.endsWith("/")) rel = "index.html";
  const abs = path.join(serveDir, rel);

  if (DEBUG_WEB) {
    console.log(
      `[WEB] project=${projectName} serveDir=${serveDir} req='${rel}' abs='${abs}'`
    );
  }

  const trySend = (p) =>
    res.sendFile(p, (err) => {
      if (err) res.status(err.statusCode || 404).send("Not Found");
    });

  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      if (DEBUG_WEB) console.log(`[WEB] 200 ${abs}`);
      return trySend(abs);
    }
  } catch {}

  // SPA fallback to index.html if present
  const indexPath = path.join(serveDir, "index.html");
  if (fs.existsSync(indexPath)) {
    if (DEBUG_WEB) console.log(`[WEB] SPA 200 ${indexPath}`);
    return trySend(indexPath);
  }
  if (DEBUG_WEB)
    console.log(`[WEB] 404 (no index.html) project=${projectName}`);
  return res.status(404).send("index.html not found for project");
}

app.get("/web/:projectName", (req, res) => sendProjectAsset(req, res));
app.get("/web/:projectName/*", (req, res) => sendProjectAsset(req, res));

// Root-level index.html serving: serve the currently active project (if set) OR fallback to a default project name via env.
app.get(["/", "/index.html"], (req, res, next) => {
  const active = getCurrentProject() || process.env.DEFAULT_WEB_PROJECT;
  if (!active)
    return res
      .status(200)
      .send(
        "No active web project configured. Set DEFAULT_WEB_PROJECT or open a project in the IDE."
      );
  // Rewrite to /web/:projectName
  req.params.projectName = active;
  req.params[0] = "index.html";
  return sendProjectAsset(req, res);
});

// Serve all non-API, non-socket.io GET paths from the active project's directory with SPA fallback
app.get(/^\/(?!api\/|socket\.io\/).+$/, (req, res) => {
  const active = getCurrentProject() || process.env.DEFAULT_WEB_PROJECT;
  if (!active)
    return res
      .status(200)
      .send(
        "No active web project configured. Use the terminal 'serve' command to select a project or set DEFAULT_WEB_PROJECT."
      );
  req.params.projectName = active;
  // Strip leading slash to form relative path
  req.params[0] = String(req.path || "/").replace(/^\//, "");
  if (DEBUG_WEB)
    console.log(`[WEB] root serve active=${active} path='${req.params[0]}'`);
  return sendProjectAsset(req, res);
});

// Debug routes
app.get("/api/debug/web-status", (req, res) => {
  const projectName = req.query.project || getCurrentProject();
  const active = getCurrentProject();
  const chosen = projectName || process.env.DEFAULT_WEB_PROJECT || null;
  const serveDir = chosen ? resolveProjectServeDir(chosen) : null;
  const hasIndex = chosen
    ? fs.existsSync(path.join(serveDir, "index.html"))
    : false;
  let sample = [];
  try {
    if (serveDir && fs.existsSync(serveDir)) {
      sample = fs.readdirSync(serveDir).slice(0, 50);

      // Debug-only: start a terminal session via HTTP (for local troubleshooting)
    }
  } catch {}
  res.json({
    debug: {
      DEBUG_WEB,
      PORT: config.PORT,
      activeProject: active || null,
      inspectProject: chosen,
      serveDir,
      hasIndex,
      sample,
    },

    // Debug-only: start web server for a terminal session
  });
});

app.get("/api/debug/web-asset", (req, res) => {
  const projectName = req.query.project || getCurrentProject();
  const p = String(req.query.path || "index.html");
  if (!projectName) return res.status(400).json({ error: "project required" });
  const dir = resolveProjectServeDir(projectName);
  const abs = path.join(dir, p.replace(/^\/+/, ""));
  const ok = fs.existsSync(abs) && fs.statSync(abs).isFile();
  res.json({ projectName, dir, path: p, abs, exists: ok });
});

// Simple upload storage
const upload = multer({ dest: config.getUploadsDir() });

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

// Container management endpoints (temporary - should be moved to controller later)
const ContainerService = require("./services/containerService");
const containerTerminal = new ContainerService();

// Single file sync endpoint (for DB-backed mode real-time updates)
app.post(
  "/api/containers/:projectName/files/sync",
  authenticateToken,
  async (req, res) => {
    try {
      const { projectName } = req.params;
      const { filePath } = req.body || {};
      if (!filePath)
        return res.status(400).json({ error: "filePath required" });
      if (typeof containerTerminal.syncFile === "function") {
        await containerTerminal.syncFile(projectName, filePath);
      }
      res.json({ success: true, message: "File synced" });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// Debug-only: start a container terminal session via HTTP
app.post("/api/debug/start-terminal", async (req, res) => {
  try {
    const { projectName, terminalId, userId } = req.body || {};
    if (!projectName)
      return res.status(400).json({ error: "projectName required" });
    const tid = String(terminalId || Date.now());
    const info = await containerTerminal.initializeTerminalSession(
      tid,
      projectName,
      userId
    );
    res.json({ terminalId: tid, info });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Debug-only: start web (nginx) for a terminal session
app.post("/api/debug/start-web", async (req, res) => {
  try {
    const { terminalId, port } = req.body || {};
    if (!terminalId)
      return res.status(400).json({ error: "terminalId required" });
    const r = await containerTerminal.startWebServer(
      terminalId,
      Number(port) || config.WEB_PORT || 8088,
      {}
    );
    const info = containerTerminal.getWebInfo(terminalId);
    if (info?.projectName) setCurrentProject(info.projectName);
    const url = info?.webPort ? `http://localhost:${info.webPort}` : null;
    res.json({ ok: r.code === 0, url, info });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Debug-only: restart containers for a project
app.post("/api/debug/restart-containers", async (req, res) => {
  try {
    const { projectName, userId } = req.body || {};
    if (!projectName)
      return res.status(400).json({ error: "projectName required" });
    if (!userId) return res.status(400).json({ error: "userId required" });

    console.log(
      `🔄 Manual container restart requested for project: ${projectName}`
    );
    const restartedSessions =
      await containerTerminal.autoRestartProjectContainers(
        projectName,
        userId,
        "manual restart",
        io // Pass io for socket notifications
      );

    res.json({
      success: true,
      restartedSessions: restartedSessions.length,
      details: restartedSessions.map((s) => ({
        terminalId: s.terminalId,
        webServerRestarted: s.webServerRestarted,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Error handling middleware
app.use(errorHandler);
app.use(notFoundHandler);

// Initialize socket handlers
const { runHistory, activeRuns } = socketHandlers(io);

// Run history APIs (temporary - should be moved to controller later)
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

// Server startup
async function start() {
  try {
    // Connect to database
    await connectDatabase();

    console.log(
      `🤖 AI Configuration: ${
        config.API_KEY
          ? "API Key configured"
          : "No API Key - AI features disabled"
      }`
    );

    // Start server
    server.listen(config.PORT, () => {
      const actualPort = server.address().port;
      console.log(
        `🚀 DevDock Backend Server running on http://localhost:${actualPort}`
      );
      console.log(`📁 Projects directory: ${config.getProjectsDir()}`);
      console.log(`🤖 AI Model: ${config.AI_MODEL}`);

      // Write port info for frontend discovery
      const portInfo = {
        port: actualPort,
        url: `http://localhost:${actualPort}`,
        timestamp: new Date().toISOString(),
      };

      // Always write to backend folder .port (frontend may fetch via dev proxy)
      const backendPortFile = path.join(__dirname, "../.port");
      fs.writeFileSync(backendPortFile, JSON.stringify(portInfo, null, 2));

      // Also mirror to repo root if backend isn't the root
      try {
        const repoRootPortFile = path.join(process.cwd(), "backend", ".port");
        if (repoRootPortFile !== backendPortFile) {
          fs.writeFileSync(repoRootPortFile, JSON.stringify(portInfo, null, 2));
        }
      } catch {}
      console.log(
        `📡 Port info written to backend/.port for frontend discovery`
      );

      // Setup container cleanup interval (every 5 minutes)
      setInterval(async () => {
        try {
          await containerTerminal.cleanup();
          await cleanupWarmContainers();
        } catch (error) {
          console.warn(`Container cleanup error: ${error.message}`);
        }
      }, 5 * 60 * 1000);

      console.log("🐳 Containerized execution environment ready");

      // Kick off optional docker image pre-pull (non-blocking) - DISABLED FOR DEBUGGING
      // prePullDockerImages();
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error.message);
    process.exit(1);
  }
}

// Graceful shutdown handling
process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, gracefully shutting down...");

  // Save container state before shutdown
  if (containerTerminal && typeof containerTerminal.saveState === "function") {
    containerTerminal.saveState();
    console.log("💾 Container state saved");
  }

  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM, gracefully shutting down...");

  // Save container state before shutdown
  if (containerTerminal && typeof containerTerminal.saveState === "function") {
    containerTerminal.saveState();
    console.log("💾 Container state saved");
  }

  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

// Start the server
start();
