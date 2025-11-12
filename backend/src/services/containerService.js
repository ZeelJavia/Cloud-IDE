const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const net = require("net");
const config = require("../config");
const { spawnWait } = require("../utils/validationUtils");
const { dockerImageExists, dockerPullImage } = require("../utils/dockerUtils");
const { getModels } = require("../config/database");

/**
 * Container Service
 * Provides containerized terminal functionality with Docker integration
 */
class ContainerService {
  constructor() {
    this.activeContainers = new Map(); // containerId -> containerInfo
    this.activeSessions = new Map(); // terminalId -> sessionInfo
    // Track per-terminal real containers
    this.windowsShell = this.detectWindowsShell();
  }

  detectWindowsShell() {
    if (process.platform !== "win32") return null;
    try {
      const systemRoot = process.env.SYSTEMROOT || process.env.SystemRoot;
      const candidates = [];
      if (systemRoot) {
        candidates.push(
          path.join(
            systemRoot,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe"
          )
        );
        candidates.push(
          path.join(
            systemRoot,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "pwsh.exe"
          )
        );
        candidates.push(path.join(systemRoot, "System32", "cmd.exe"));
      }
      // Typical PowerShell 7 location (MSI)
      candidates.push(
        path.join("C:", "Program Files", "PowerShell", "7", "pwsh.exe")
      );
      // Fallback to PATH provided shells
      candidates.push("powershell.exe");
      candidates.push("pwsh.exe");
      candidates.push(process.env.ComSpec || "cmd.exe");

      const fs = require("fs");
      for (const c of candidates) {
        try {
          if (c.includes(".exe") && fs.existsSync(c)) return c;
        } catch {}
      }
      return process.env.ComSpec || "cmd.exe";
    } catch {
      return process.env.ComSpec || "cmd.exe";
    }
  }

  /**
   * Initialize terminal session for a project
   */
  async initializeTerminalSession(terminalId, projectName, userId) {
    console.log(
      `🐳 Initializing container terminal for project: ${projectName}`
    );
    // Ensure docker is available
    const hasDocker = await spawnWait("docker", ["--version"]);
    if (hasDocker.code !== 0) {
      throw new Error("Docker not available on host");
    }

    // Choose base image (Linux) for terminal sessions
    const baseImage = process.env.DOCKER_BASE_IMAGE || "ubuntu:22.04";
    const imgPresent = await dockerImageExists(baseImage);
    if (!imgPresent) {
      const pullCode = await dockerPullImage(baseImage);
      if (pullCode !== 0) {
        throw new Error(`Failed to pull base image ${baseImage}`);
      }
    }

    let projectHostDir = path.join(config.getProjectsDir(), projectName);
    let useVolume = false;
    let projectVolumeName = null;

    // If we are in DB mode, materialize project files to ephemeral dir
    let ephemeralDir = null;
    try {
      const { ProjectModel, FileModel } = getModels();
      if (config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
        const proj = await ProjectModel.findOne({
          name: projectName,
          owner: userId,
        }).lean();
        if (proj) {
          const allFiles = await FileModel.find({ project: proj._id }).lean();
          if (
            config.IN_CONTAINER_DB_FETCH_BOOL &&
            !config.MATERIALIZE_DB_TO_FS_BOOL
          ) {
            // Use a named docker volume; no local writes
            projectVolumeName = this.makeVolumeName(
              projectName,
              userId,
              terminalId
            );
            const v = await spawnWait("docker", [
              "volume",
              "create",
              projectVolumeName,
            ]);
            if (v.code !== 0) {
              throw new Error(`Failed to create volume: ${projectVolumeName}`);
            }
            useVolume = true;
            // Defer actual file population until container is running
            // We'll populate after container start via docker exec
            sessionPendingFiles = allFiles; // temp var defined below
          } else {
            // Fallback: materialize to ephemeral dir on host
            ephemeralDir = fs.mkdtempSync(
              path.join(os.tmpdir(), `devdock-${projectName}-`)
            );
            for (const f of allFiles) {
              const targetPath = path.join(ephemeralDir, f.path);
              if (f.type === "folder") {
                fs.mkdirSync(targetPath, { recursive: true });
              } else {
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                fs.writeFileSync(targetPath, f.content || "", "utf8");
              }
            }
            projectHostDir = ephemeralDir;
          }
        } else {
          console.log(
            `DB mode enabled but project '${projectName}' not found in DB; using filesystem at ${projectHostDir}`
          );
        }
      }
    } catch (e) {
      console.warn(`DB materialization skipped: ${e.message}`);
    }

    // Allocate a host port for inside 8080
    const mappedPort = await this.getFreePort();

    const containerName = this.makeContainerName(
      projectName,
      userId,
      terminalId
    );

    // Run long-lived container
    const argsCreate = [
      "run",
      "-dit",
      "--name",
      containerName,
      ...(useVolume
        ? ["-v", `${projectVolumeName}:/workspace`]
        : ["-v", `${projectHostDir}:/workspace`]),
      "-w",
      "/workspace",
      "-p",
      `${mappedPort}:8080`,
      baseImage,
      "bash",
      "-lc",
      "sleep infinity",
    ];

    const started = await spawnWait("docker", argsCreate);
    if (started.code !== 0) {
      throw new Error(
        started.stderr || started.stdout || "Failed to start container"
      );
    }

    const sessionInfo = {
      terminalId,
      projectName,
      userId,
      workingDirectory: "/workspace",
      projectHostDir: useVolume ? null : projectHostDir,
      projectVolumeName: useVolume ? projectVolumeName : null,
      projectType: "linux",
      containerId: containerName,
      mappedPort,
      baseImage,
      initialized: true,
      ephemeralDir,
    };

    this.activeSessions.set(terminalId, sessionInfo);

    // Optional: mirror DB-backed project files to backend/projects if enabled
    try {
      if (config.MATERIALIZE_DB_TO_FS_BOOL) {
        await this.syncProjectFiles(projectName, userId);
      }
    } catch (e) {
      console.warn(`Project sync warning: ${e.message}`);
    }

    // Populate files directly inside container volume when enabled
    try {
      if (useVolume) {
        const { ProjectModel, FileModel } = getModels();
        const proj = await ProjectModel.findOne({
          name: projectName,
          owner: userId,
        }).lean();
        if (proj) {
          const allFiles = await FileModel.find({ project: proj._id }).lean();
          await this.populateFilesInContainer(containerName, allFiles);
        }
      }
    } catch (e) {
      console.warn(`In-container population warning: ${e.message}`);
    }

    return {
      projectType: sessionInfo.projectType,
      mappedPort: sessionInfo.mappedPort,
      containerId: sessionInfo.containerId,
      initialized: true,
    };
  }

  /**
   * Execute command in terminal session
   */
  async executeCommand(terminalId, command, options = {}) {
    const session = this.activeSessions.get(terminalId);

    if (!session) {
      throw new Error(
        "Terminal session not initialized. Please select a project first."
      );
    }

    return new Promise(async (resolve, reject) => {
      // Execute inside the project's container
      const containerId = session.containerId;
      if (!containerId) return reject(new Error("Container not initialized"));

      // Maintain a simple logical working directory inside container
      let workingDir = session.workingDirectory || "/workspace";

      // Handle chained commands and cd internally by prefixing with 'cd'
      const cmd = String(command).trim();
      const parts = cmd
        .split(/&&/)
        .map((s) => s.trim())
        .filter(Boolean);

      const runOne = (cmdStr) =>
        new Promise((res, rej) => {
          const finalCmd = `cd ${JSON.stringify(workingDir)} && ${cmdStr}`;
          const child = spawn(
            "docker",
            ["exec", "-i", containerId, "bash", "-lc", finalCmd],
            { env: process.env, shell: false }
          );
          if (options.onProcess) options.onProcess(child);
          child.stdout.on("data", (d) => options.onStdout?.(d.toString()));
          child.stderr.on("data", (d) => options.onStderr?.(d.toString()));
          child.on("close", (code) => res(code ?? 0));
          child.on("error", (e) => rej(e));
        });

      try {
        for (const segment of parts) {
          const m = segment.match(/^cd\s+(.*)$/i) || segment.match(/^cd$/i);
          if (m) {
            const target = (m[1] || "").trim();
            if (!target || target === "~") workingDir = "/workspace";
            else if (target.startsWith("/")) workingDir = target;
            else workingDir = path.posix.resolve(workingDir, target);
            session.workingDirectory = workingDir;
            continue;
          }
          await runOne(segment);
        }
        resolve({
          code: 0,
          stdout: "",
          stderr: "",
          workingDirectory: workingDir,
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Start web server in session
   */
  async startWebServer(terminalId, port = 8080, options = {}) {
    const session = this.activeSessions.get(terminalId);

    if (!session) {
      throw new Error("Terminal session not initialized.");
    }
    // Instead of installing nginx inside the dev container (slow on first run, problematic on Windows host),
    // run a lightweight separate nginx:alpine container that mounts the project directory read-only.
    const usingVolume = !!session.projectVolumeName;
    const hostDir =
      session.projectHostDir ||
      path.join(config.getProjectsDir(), session.projectName);
    let serveDir = hostDir;
    if (!usingVolume) {
      try {
        if (fs.existsSync(path.join(hostDir, "public", "index.html"))) {
          serveDir = path.join(hostDir, "public");
        } else if (fs.existsSync(path.join(hostDir, "dist", "index.html"))) {
          serveDir = path.join(hostDir, "dist");
        } else if (!fs.existsSync(path.join(hostDir, "index.html"))) {
          options.onStderr?.(
            "⚠️  index.html not found; serving project root\n"
          );
        }
      } catch {}
    }

    // Clean previous web container if exists
    if (session.webContainerId) {
      try {
        await spawnWait("docker", ["rm", "-f", session.webContainerId]);
      } catch {}
      session.webContainerId = null;
    }

    // Enforce a fixed host port for web serving (config.WEB_PORT). Ignore caller's port except for logging.
    const fixedPort = Number(config.WEB_PORT) || 8088;
    const requested = Number(port) || undefined;
    let webPort = fixedPort;
    if (requested && requested !== fixedPort) {
      options.onStderr?.(
        `Requested port ${requested} ignored; using fixed WEB_PORT ${fixedPort}\n`
      );
    }
    const webName = `${this.makeContainerName(
      session.projectName,
      session.userId,
      terminalId
    )}-web`;

    // SPA-friendly nginx config mounted into container
    const spaConf = `server {\n  listen 80;\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}`;
    const confPath = path.join(os.tmpdir(), `devdock-nginx-${terminalId}.conf`);
    try {
      fs.writeFileSync(confPath, spaConf, "utf8");
    } catch {}

    // Normalize Windows path for Docker mount (use forward slashes)
    const mountDir = serveDir.replace(/\\/g, "/");
    const args = [
      "run",
      "-d",
      "--rm",
      "--name",
      webName,
      "-p",
      `${webPort}:80`,
      ...(usingVolume
        ? ["-v", `${session.projectVolumeName}:/usr/share/nginx/html:ro`]
        : ["-v", `${mountDir}:/usr/share/nginx/html:ro`]),
    ];
    if (fs.existsSync(confPath)) {
      args.push("-v", `${confPath}:/etc/nginx/conf.d/default.conf:ro`);
    }
    args.push("nginx:alpine");

    const started = await spawnWait("docker", args);
    if (started.code !== 0) {
      // Fail fast if fixed port is busy or container can't start; do NOT fallback.
      options.onStderr?.(
        `Failed to start web server on fixed port ${webPort}: ` +
          (started.stderr || started.stdout || "unknown error") +
          "\n"
      );
      return {
        code: -1,
        webPort,
        serveDir,
        error: "PORT_BUSY_OR_START_FAILED",
      };
    }

    session.webContainerId = webName;
    session.webPort = webPort;
    return { code: 0, webPort, serveDir };
  }

  /**
   * Update terminal working directory
   */
  updateTerminalWorkingDirectory(terminalId, workingDirectory) {
    const session = this.activeSessions.get(terminalId);
    if (session) {
      session.workingDirectory = workingDirectory;
      console.log(
        `Updated terminal ${terminalId} working directory to: ${workingDirectory}`
      );
    }
  }

  getSession(terminalId) {
    return this.activeSessions.get(terminalId);
  }

  /**
   * List sanitized session info for debugging
   */
  listSessions() {
    const out = [];
    for (const [tid, s] of this.activeSessions.entries()) {
      out.push({
        terminalId: tid,
        projectName: s.projectName,
        userId: s.userId,
        containerId: s.containerId,
        mappedPort: s.mappedPort,
        webPort: s.webPort,
        webContainerId: s.webContainerId,
        workingDirectory: s.workingDirectory,
        projectHostDir: s.projectHostDir,
        baseImage: s.baseImage,
        initialized: s.initialized,
      });
    }
    return out;
  }

  /**
   * Get user terminal sessions
   */
  getUserTerminalSessions(userId) {
    const userTerminals = [];
    for (const [terminalId, session] of this.activeSessions.entries()) {
      if (session.userId === userId) {
        userTerminals.push(terminalId);
      }
    }
    return userTerminals;
  }

  /**
   * Get user containers
   */
  getUserContainers(userId) {
    const userContainers = [];
    for (const [terminalId, session] of this.activeSessions.entries()) {
      if (session.userId === userId) {
        userContainers.push({
          containerId: `mock-container-${terminalId}`,
          projectName: session.projectName,
          type: "basic",
        });
      }
    }
    return userContainers;
  }

  /**
   * Stop terminal session
   */
  async stopTerminalSession(terminalId) {
    const session = this.activeSessions.get(terminalId);
    if (session) {
      this.activeSessions.delete(terminalId);
      try {
        if (session.containerId) {
          await spawnWait("docker", ["rm", "-f", session.containerId]);
        }
        if (session.webContainerId) {
          await spawnWait("docker", ["rm", "-f", session.webContainerId]);
        }
        if (session.projectVolumeName) {
          await spawnWait("docker", [
            "volume",
            "rm",
            session.projectVolumeName,
          ]);
        }
      } catch {}
      // Cleanup ephemeral directory if created
      try {
        if (session.ephemeralDir)
          fs.rmSync(session.ephemeralDir, { recursive: true, force: true });
      } catch {}
      console.log(`Terminal session ${terminalId} stopped`);
    }
  }

  /**
   * Stop container (mock implementation)
   */
  async stopContainer(containerId) {
    try {
      await spawnWait("docker", ["rm", "-f", containerId]);
    } catch {}
  }

  // Sync a single file change from DB to ephemeral directory (if exists)
  async syncFile(projectName, filePath) {
    for (const session of this.activeSessions.values()) {
      if (session.projectName === projectName && session.ephemeralDir) {
        try {
          const { ProjectModel, FileModel } = getModels();
          if (!(ProjectModel && FileModel)) return;
          const proj = await ProjectModel.findOne({ name: projectName }).lean();
          if (!proj) return;
          const doc = await FileModel.findOne({
            project: proj._id,
            path: filePath,
            type: "file",
          }).lean();
          if (!doc) return;
          const target = path.join(session.ephemeralDir, filePath);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, doc.content || "", "utf8");
        } catch (e) {
          console.warn(`File sync failed for ${filePath}: ${e.message}`);
        }
      }
    }
  }

  /**
   * Get container URL (mock implementation)
   */
  getContainerUrl(containerInfo) {
    if (containerInfo && containerInfo.mappedPort) {
      return `http://localhost:${containerInfo.mappedPort}`;
    }
    return null;
  }

  /**
   * Cleanup old containers
   */
  async cleanup() {
    // No-op: containers are per-session and removed on stop
    console.log("Container cleanup checked");
  }

  // Helpers
  makeContainerName(projectName, userId, terminalId) {
    const safeProj = String(projectName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);
    const safeUser = String(userId || "u")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 16);
    return `devdock-${safeUser}-${safeProj}-${terminalId}-${Date.now().toString(
      36
    )}`;
  }

  getFreePort() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
      srv.on("error", (e) => reject(e));
    });
  }

  getWebInfo(terminalId) {
    const s = this.activeSessions.get(terminalId);
    if (!s) return null;
    return {
      webContainerId: s.webContainerId,
      webPort: s.webPort,
      projectName: s.projectName,
      serveDir: s.projectHostDir,
      projectVolumeName: s.projectVolumeName || null,
    };
  }

  async getWebLogs(terminalId, tail = 200) {
    const s = this.activeSessions.get(terminalId);
    if (!s || !s.webContainerId) return { logs: "", code: -1 };
    const out = await spawnWait("docker", [
      "logs",
      "--tail",
      String(tail),
      s.webContainerId,
    ]);
    return { code: out.code, logs: (out.stdout || "") + (out.stderr || "") };
  }

  async syncProjectFiles(projectName, userId) {
    const fs = require("fs");
    const fsp = fs.promises;
    const { getModels } = require("../config/database");
    const { ProjectModel, FileModel } = getModels();
    if (!(config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel)) return;

    const proj = await ProjectModel.findOne({
      owner: userId,
      name: projectName,
    }).lean();
    if (!proj) throw new Error("Project not found");
    const files = await FileModel.find({ project: proj._id }).lean();
    const targetDir = path.join(config.getProjectsDir(), projectName);
    await fsp.mkdir(targetDir, { recursive: true });

    for (const file of files) {
      const rel = String(file.path || "");
      if (!rel) continue;
      const dest = path.join(targetDir, rel);
      if (file.type === "folder") {
        await fsp.mkdir(dest, { recursive: true });
      } else {
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, file.content || "", "utf8");
      }
    }
  }
}

module.exports = ContainerService;

// Helpers specific to ContainerService methods
ContainerService.prototype.makeVolumeName = function (
  projectName,
  userId,
  terminalId
) {
  const safeProj = String(projectName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const safeUser = String(userId || "u")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 16);
  return `devdock-vol-${safeUser}-${safeProj}-${terminalId}-${Date.now().toString(
    36
  )}`;
};

ContainerService.prototype.populateFilesInContainer = async function (
  containerId,
  files
) {
  // Write folders/files directly inside container using docker exec + cat
  // Files expected to have fields: path, type ('file'|'folder'), content (for files)
  for (const f of files) {
    try {
      const rel = String(f.path || "").replace(/\\/g, "/");
      if (!rel) continue;
      if (f.type === "folder") {
        await spawnWait("docker", [
          "exec",
          containerId,
          "sh",
          "-lc",
          `mkdir -p /workspace/${rel}`,
        ]);
      } else {
        const dir = path.posix.dirname(`/workspace/${rel}`);
        await spawnWait("docker", [
          "exec",
          containerId,
          "sh",
          "-lc",
          `mkdir -p ${dir}`,
        ]);
        await new Promise((resolve) => {
          const child = spawn(
            "docker",
            ["exec", "-i", containerId, "sh", "-lc", `cat > /workspace/${rel}`],
            { env: process.env, shell: false }
          );
          child.stdin.write(f.content || "");
          child.stdin.end();
          child.on("close", () => resolve());
          child.on("error", () => resolve());
        });
      }
    } catch (e) {
      console.warn(`populate file failed for ${f.path}: ${e.message}`);
    }
  }
};
