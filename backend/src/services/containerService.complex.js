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
    console.log(`\n🔧 [CONTAINER] Initializing terminal session`);
    console.log(`   📋 Terminal ID: ${terminalId}`);
    console.log(`   📦 Project: ${projectName}`);
    console.log(`   👤 User: ${userId}`);

    // Ensure docker is available
    console.log(`   🔍 Checking Docker availability...`);
    const hasDocker = await spawnWait("docker", ["--version"]);
    if (hasDocker.code !== 0) {
      console.error(
        `   ❌ Docker not available: ${hasDocker.stderr || hasDocker.stdout}`
      );
      throw new Error("Docker not available on host");
    }
    console.log(`   ✅ Docker is available`);

    // Choose base image (Linux) for terminal sessions
    const baseImage = process.env.DOCKER_BASE_IMAGE || "ubuntu:22.04";
    console.log(`   🐧 Base image: ${baseImage}`);

    const imgPresent = await dockerImageExists(baseImage);
    if (!imgPresent) {
      console.log(`   📥 Pulling base image ${baseImage}...`);
      const pullCode = await dockerPullImage(baseImage);
      if (pullCode !== 0) {
        console.error(`   ❌ Failed to pull base image ${baseImage}`);
        throw new Error(`Failed to pull base image ${baseImage}`);
      }
      console.log(`   ✅ Base image ${baseImage} pulled successfully`);
    } else {
      console.log(`   ✅ Base image ${baseImage} already available`);
    }

    let projectHostDir = path.join(config.getProjectsDir(), projectName);
    let useVolume = false;
    let projectVolumeName = null;

    console.log(`   📁 Project host directory: ${projectHostDir}`);

    // If we are in DB mode, materialize project files to ephemeral dir
    let ephemeralDir = null;
    try {
      const { ProjectModel, FileModel } = getModels();
      if (config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
        console.log(
          `   🗄️  DB projects enabled - looking up project in database...`
        );

        // Try to find project - first with owner, then fallback to name-only
        let proj = null;
        try {
          proj = await ProjectModel.findOne({
            name: projectName,
            owner: userId,
          }).lean();
        } catch (e) {
          console.log(`   ⚠️  Owner-based lookup failed: ${e.message}`);
          console.log(`   🔄 Trying name-only lookup...`);
          try {
            proj = await ProjectModel.findOne({ name: projectName }).lean();
          } catch (e2) {
            console.log(`   ❌ Name-only lookup also failed: ${e2.message}`);
          }
        }

        if (proj) {
          console.log(`   ✅ Project found in DB (ID: ${proj._id})`);
          const allFiles = await FileModel.find({ project: proj._id }).lean();
          console.log(`   📄 Found ${allFiles.length} files in project`);

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
            console.log(`   💾 Creating Docker volume: ${projectVolumeName}`);
            const v = await spawnWait("docker", [
              "volume",
              "create",
              projectVolumeName,
            ]);
            if (v.code !== 0) {
              console.error(
                `   ❌ Failed to create volume: ${v.stderr || v.stdout}`
              );
              throw new Error(`Failed to create volume: ${projectVolumeName}`);
            }
            console.log(`   ✅ Docker volume created successfully`);
            useVolume = true;
            console.log(`   🔄 Will populate files in container after startup`);
          } else {
            // Fallback: materialize to ephemeral dir on host
            console.log(`   📂 Creating ephemeral directory on host...`);
            ephemeralDir = fs.mkdtempSync(
              path.join(os.tmpdir(), `devdock-${projectName}-`)
            );
            console.log(`   📂 Ephemeral directory: ${ephemeralDir}`);

            let fileCount = 0;
            let folderCount = 0;
            for (const f of allFiles) {
              const targetPath = path.join(ephemeralDir, f.path);
              if (f.type === "folder") {
                fs.mkdirSync(targetPath, { recursive: true });
                folderCount++;
              } else {
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                fs.writeFileSync(targetPath, f.content || "", "utf8");
                fileCount++;
              }
            }
            console.log(
              `   ✅ Materialized ${fileCount} files and ${folderCount} folders to host`
            );
            projectHostDir = ephemeralDir;
          }
        } else {
          console.log(
            `   ⚠️  Project '${projectName}' not found in DB - using filesystem`
          );
          console.log(`   📁 Filesystem path: ${projectHostDir}`);
        }
      } else {
        console.log(`   📁 Using filesystem storage (DB projects disabled)`);
      }
    } catch (e) {
      console.warn(`   ⚠️  DB materialization skipped: ${e.message}`);
    }

    // Allocate a host port for inside 8080
    console.log(`   🔌 Allocating free port for container...`);
    const mappedPort = await this.getFreePort();
    console.log(
      `   ✅ Allocated port ${mappedPort} for container internal port 8080`
    );

    const containerName = this.makeContainerName(
      projectName,
      userId,
      terminalId
    );
    console.log(`   🏷️  Container name: ${containerName}`);

    // Run long-lived container
    const mountSource = useVolume ? projectVolumeName : projectHostDir;
    const mountType = useVolume ? "volume" : "bind";
    console.log(`   🔗 Mount configuration:`);
    console.log(`      Type: ${mountType}`);
    console.log(`      Source: ${mountSource}`);
    console.log(`      Target: /workspace`);

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

    console.log(`   🚀 Starting container with command:`);
    console.log(`      docker ${argsCreate.join(" ")}`);
    const started = await spawnWait("docker", argsCreate);
    if (started.code !== 0) {
      console.error(`   ❌ Container start failed:`);
      console.error(`      Exit code: ${started.code}`);
      console.error(`      stdout: ${started.stdout || "none"}`);
      console.error(`      stderr: ${started.stderr || "none"}`);
      throw new Error(
        started.stderr || started.stdout || "Failed to start container"
      );
    }
    console.log(`   ✅ Container started successfully`);
    console.log(`   🆔 Container ID: ${containerName}`);
    console.log(`   🔌 Port mapping: ${mappedPort}:8080`);

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

        // Try to find project - first with owner, then fallback to name-only
        let proj = null;
        try {
          proj = await ProjectModel.findOne({
            name: projectName,
            owner: userId,
          }).lean();
        } catch (e) {
          console.log(
            `   ⚠️  Volume population owner-based lookup failed: ${e.message}`
          );
          try {
            proj = await ProjectModel.findOne({ name: projectName }).lean();
          } catch (e2) {
            console.log(
              `   ❌ Volume population name-only lookup failed: ${e2.message}`
            );
          }
        }

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
    console.log(`\n⚡ [COMMAND] Executing command in terminal ${terminalId}`);
    console.log(`   📝 Command: ${command}`);

    const session = this.activeSessions.get(terminalId);
    if (!session) {
      console.error(`   ❌ Terminal session ${terminalId} not found`);
      throw new Error(
        "Terminal session not initialized. Please select a project first."
      );
    }

    console.log(`   📋 Session details:`);
    console.log(`      Project: ${session.projectName}`);
    console.log(`      Container: ${session.containerId}`);
    console.log(
      `      Working dir: ${session.workingDirectory || "/workspace"}`
    );

    return new Promise(async (resolve, reject) => {
      // Execute inside the project's container
      const containerId = session.containerId;
      if (!containerId) {
        console.error(
          `   ❌ Container not initialized for session ${terminalId}`
        );
        return reject(new Error("Container not initialized"));
      }

      // Maintain a simple logical working directory inside container
      let workingDir = session.workingDirectory || "/workspace";
      console.log(`   📁 Current working directory: ${workingDir}`);

      // Handle chained commands and cd internally by prefixing with 'cd'
      const cmd = String(command).trim();
      const parts = cmd
        .split(/&&/)
        .map((s) => s.trim())
        .filter(Boolean);

      console.log(`   🔗 Command has ${parts.length} parts:`);
      parts.forEach((part, i) => console.log(`      ${i + 1}. ${part}`));

      const runOne = (cmdStr) =>
        new Promise((res, rej) => {
          const finalCmd = `cd ${JSON.stringify(workingDir)} && ${cmdStr}`;
          console.log(
            `   🔧 Executing: docker exec -i ${containerId} bash -lc "${finalCmd}"`
          );
          const child = spawn(
            "docker",
            ["exec", "-i", containerId, "bash", "-lc", finalCmd],
            { env: process.env, shell: false }
          );
          if (options.onProcess) options.onProcess(child);
          child.stdout.on("data", (d) => {
            const output = d.toString();
            console.log(`   📤 stdout: ${output.replace(/\n/g, "\\n")}`);
            options.onStdout?.(output);
          });
          child.stderr.on("data", (d) => {
            const output = d.toString();
            console.log(`   📤 stderr: ${output.replace(/\n/g, "\\n")}`);
            options.onStderr?.(output);
          });
          child.on("close", (code) => {
            console.log(`   ✅ Command completed with exit code: ${code ?? 0}`);
            res(code ?? 0);
          });
          child.on("error", (e) => {
            console.error(`   ❌ Command execution error: ${e.message}`);
            rej(e);
          });
        });

      try {
        for (const segment of parts) {
          const m = segment.match(/^cd\s+(.*)$/i) || segment.match(/^cd$/i);
          if (m) {
            const target = (m[1] || "").trim();
            const oldDir = workingDir;
            if (!target || target === "~") workingDir = "/workspace";
            else if (target.startsWith("/")) workingDir = target;
            else workingDir = path.posix.resolve(workingDir, target);
            console.log(`   📁 Directory change: ${oldDir} -> ${workingDir}`);
            session.workingDirectory = workingDir;
            continue;
          }
          await runOne(segment);
        }
        console.log(`   ✅ All command parts executed successfully`);
        resolve({
          code: 0,
          stdout: "",
          stderr: "",
          workingDirectory: workingDir,
        });
      } catch (e) {
        console.error(`   ❌ Command execution failed: ${e.message}`);
        reject(e);
      }
    });
  }

  /**
   * Start web server in session
   */
  async startWebServer(terminalId, port = 8080, options = {}) {
    console.log(
      `\n🌐 [WEB SERVER] Starting web server for terminal ${terminalId}`
    );

    const session = this.activeSessions.get(terminalId);
    if (!session) {
      console.error(`   ❌ Terminal session ${terminalId} not found`);
      throw new Error("Terminal session not initialized.");
    }

    console.log(`   📋 Session info:`);
    console.log(`      Project: ${session.projectName}`);
    console.log(`      User: ${session.userId}`);
    console.log(`      Container: ${session.containerId}`);

    // Instead of installing nginx inside the dev container (slow on first run, problematic on Windows host),
    // run a lightweight separate nginx:alpine container that mounts the project directory read-only.
    const usingVolume = !!session.projectVolumeName;
    const hostDir =
      session.projectHostDir ||
      path.join(config.getProjectsDir(), session.projectName);
    let serveDir = hostDir;

    console.log(`   📁 Determining serve directory...`);
    console.log(`      Base directory: ${hostDir}`);
    console.log(`      Using volume: ${usingVolume}`);

    if (!usingVolume) {
      // For filesystem projects, look for index.html in common directories
      const candidates = [
        {
          path: path.join(hostDir, "public", "index.html"),
          dir: path.join(hostDir, "public"),
          name: "public",
        },
        {
          path: path.join(hostDir, "dist", "index.html"),
          dir: path.join(hostDir, "dist"),
          name: "dist",
        },
        { path: path.join(hostDir, "index.html"), dir: hostDir, name: "root" },
      ];

      let foundIndex = false;
      for (const candidate of candidates) {
        try {
          if (fs.existsSync(candidate.path)) {
            serveDir = candidate.dir;
            console.log(
              `   ✅ Found index.html in ${candidate.name} directory: ${candidate.path}`
            );
            foundIndex = true;
            break;
          }
        } catch (e) {
          console.warn(`   ⚠️  Error checking ${candidate.name}: ${e.message}`);
        }
      }

      if (!foundIndex) {
        console.warn(
          `   ⚠️  No index.html found in public/, dist/, or root - serving project root`
        );
        options.onStderr?.("⚠️  index.html not found; serving project root\n");
      }
    } else {
      // For MongoDB projects using volumes, we don't use host filesystem
      console.log(`   💾 Using Docker volume: ${session.projectVolumeName}`);
      console.log(
        `   📦 MongoDB project - files are materialized in container volume`
      );
      serveDir = null; // Will mount volume instead of host directory
    }

    if (serveDir) {
      console.log(`   📂 Host serve directory: ${serveDir}`);
    } else {
      console.log(
        `   📂 Will serve from Docker volume: ${session.projectVolumeName}`
      );
    }

    // Clean previous web container if exists
    if (session.webContainerId) {
      console.log(
        `   🧹 Cleaning up previous web container: ${session.webContainerId}`
      );
      try {
        const cleanup = await spawnWait("docker", [
          "rm",
          "-f",
          session.webContainerId,
        ]);
        console.log(
          `   ✅ Previous container cleaned up (exit code: ${cleanup.code})`
        );
      } catch (e) {
        console.warn(`   ⚠️  Cleanup warning: ${e.message}`);
      }
      session.webContainerId = null;
    }

    // Enforce a fixed host port for web serving (config.WEB_PORT). Ignore caller's port except for logging.
    const fixedPort = Number(config.WEB_PORT) || 8088;
    const requested = Number(port) || undefined;
    let webPort = fixedPort;

    console.log(`   🔌 Port configuration:`);
    console.log(`      Requested port: ${requested || "default"}`);
    console.log(`      Fixed WEB_PORT: ${fixedPort}`);

    if (requested && requested !== fixedPort) {
      console.log(
        `   ⚠️  Ignoring requested port ${requested}, using fixed WEB_PORT ${fixedPort}`
      );
      options.onStderr?.(
        `Requested port ${requested} ignored; using fixed WEB_PORT ${fixedPort}\n`
      );
    }

    const webName = `${this.makeContainerName(
      session.projectName,
      session.userId,
      terminalId
    )}-web`;
    console.log(`   🏷️  Web container name: ${webName}`);

    // SPA-friendly nginx config mounted into container
    console.log(`   📝 Generating nginx configuration...`);
    const spaConf = `server {\n  listen 80;\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}`;
    const confPath = path.join(os.tmpdir(), `devdock-nginx-${terminalId}.conf`);
    try {
      fs.writeFileSync(confPath, spaConf, "utf8");
      console.log(`   ✅ Nginx config written to: ${confPath}`);
    } catch (e) {
      console.error(`   ❌ Failed to write nginx config: ${e.message}`);
    }

    // Normalize host path for Docker mount (use forward slashes)
    // On Windows convert "C:\path\to" -> "/c/path/to" for Linux containers
    function normalizeHostPathForDocker(p) {
      if (!p) return p;
      let out = String(p).replace(/\\/g, "/");
      if (process.platform === "win32") {
        // Convert leading drive letter
        const m = out.match(/^([A-Za-z]):\/(.*)/);
        if (m) {
          const drive = m[1].toLowerCase();
          out = `/${drive}/${m[2]}`;
        }
      }
      return out;
    }

    // Only normalize if we have a host directory to mount
    const mountDir = serveDir ? normalizeHostPathForDocker(serveDir) : null;

    console.log(`   🔧 Mount configuration:`);
    if (usingVolume) {
      console.log(
        `      Volume mount: ${session.projectVolumeName} -> /usr/share/nginx/html`
      );
    } else {
      console.log(`      Host mount: ${mountDir} -> /usr/share/nginx/html`);
    }

    // Check if fixed host port is available before attempting to start container
    try {
      const portCheckServer = net.createServer();
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          portCheckServer.close();
          resolve(); // Assume port is available if we can't determine quickly
        }, 1000);

        portCheckServer.once("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        portCheckServer.listen(webPort, () => {
          clearTimeout(timeout);
          portCheckServer.close();
          resolve();
        });
      });
    } catch (e) {
      if (e.code === "EADDRINUSE") {
        options.onStderr?.(
          `Fixed WEB_PORT ${webPort} is already in use on the host. Stop the existing service or change WEB_PORT.\n`
        );
        return {
          code: -1,
          webPort,
          serveDir,
          error: "PORT_IN_USE",
        };
      }
      // For other errors, proceed but warn
      options.onStderr?.(
        `Warning: Could not verify port ${webPort} availability: ${e.message}\n`
      );
    }

    // Build Docker run arguments
    const args = [
      "run",
      "-d",
      "--rm",
      "--name",
      webName,
      "-p",
      `0.0.0.0:${webPort}:80`,
    ];

    // Add volume mount - either Docker volume or host directory
    let mountInfo;
    if (usingVolume) {
      args.push("-v", `${session.projectVolumeName}:/usr/share/nginx/html:ro`);
      mountInfo = `${session.projectVolumeName}:/usr/share/nginx/html:ro (Docker Volume)`;
    } else if (mountDir) {
      args.push("-v", `${mountDir}:/usr/share/nginx/html:ro`);
      mountInfo = `${mountDir}:/usr/share/nginx/html:ro (Host Directory)`;
    } else {
      console.error(`   ❌ No valid mount source for web container!`);
      return {
        code: -1,
        webPort,
        serveDir,
        error: "NO_MOUNT_SOURCE",
      };
    }

    if (fs.existsSync(confPath)) {
      args.push("-v", `${confPath}:/etc/nginx/conf.d/default.conf:ro`);
    }
    args.push("nginx:alpine");

    console.log(`   🐳 Starting nginx container...`);
    console.log(`      Command: docker ${args.join(" ")}`);
    console.log(`      Mount: ${mountInfo}`);
    console.log(`      Port: 0.0.0.0:${webPort}:80`);
    if (fs.existsSync(confPath)) {
      console.log(
        `      Config: ${confPath}:/etc/nginx/conf.d/default.conf:ro`
      );
    } else {
      console.log(`      Config: Using default nginx configuration`);
    }

    const started = await spawnWait("docker", args);

    console.log(`   📊 Docker run result:`);
    console.log(`      Exit code: ${started.code}`);
    console.log(`      Stdout: ${started.stdout || "(none)"}`);
    console.log(`      Stderr: ${started.stderr || "(none)"}`);

    if (started.code !== 0) {
      console.error(`   ❌ Failed to start nginx container!`);
      console.error(
        `      Error details: ${
          started.stderr || started.stdout || "unknown error"
        }`
      );
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

    console.log(`   ✅ Nginx container started successfully: ${webName}`);

    // Verify container is running
    try {
      console.log(`   🔍 Verifying container status...`);
      const inspect = await spawnWait("docker", [
        "inspect",
        webName,
        "--format",
        "{{.State.Status}}",
      ]);
      if (inspect.code === 0) {
        const status = inspect.stdout.trim();
        console.log(`      Container status: ${status}`);
        if (status !== "running") {
          console.warn(`   ⚠️  Container is not running! Status: ${status}`);
          // Get container logs for debugging
          const logs = await spawnWait("docker", ["logs", webName]);
          console.log(`      Container logs: ${logs.stdout || "(none)"}`);
          console.error(`      Container errors: ${logs.stderr || "(none)"}`);
        }
      } else {
        console.warn(`   ⚠️  Could not inspect container: ${inspect.stderr}`);
      }
    } catch (e) {
      console.warn(`   ⚠️  Container verification error: ${e.message}`);
    }

    session.webContainerId = webName;
    session.webPort = webPort;

    console.log(
      `   🌐 Web server should be available at: http://localhost:${webPort}`
    );

    if (usingVolume) {
      console.log(
        `   💾 Serving files from Docker volume: ${session.projectVolumeName}`
      );
    } else {
      console.log(`   📁 Serving files from host directory: ${serveDir}`);
    }

    return {
      code: 0,
      webPort,
      serveDir: usingVolume ? `volume:${session.projectVolumeName}` : serveDir,
      usingVolume,
    };
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
    console.log(`\n🛑 [CLEANUP] Stopping terminal session ${terminalId}`);

    const session = this.activeSessions.get(terminalId);
    if (session) {
      console.log(`   📋 Session details:`);
      console.log(`      Project: ${session.projectName}`);
      console.log(`      User: ${session.userId}`);
      console.log(`      Container: ${session.containerId || "none"}`);
      console.log(`      Web container: ${session.webContainerId || "none"}`);
      console.log(`      Volume: ${session.projectVolumeName || "none"}`);
      console.log(`      Ephemeral dir: ${session.ephemeralDir || "none"}`);

      this.activeSessions.delete(terminalId);
      console.log(`   ✅ Session removed from active sessions`);

      try {
        if (session.containerId) {
          console.log(`   🗑️  Removing main container: ${session.containerId}`);
          const mainResult = await spawnWait("docker", [
            "rm",
            "-f",
            session.containerId,
          ]);
          console.log(
            `   ${
              mainResult.code === 0 ? "✅" : "⚠️"
            } Main container removal: exit code ${mainResult.code}`
          );
        }

        if (session.webContainerId) {
          console.log(
            `   🗑️  Removing web container: ${session.webContainerId}`
          );
          const webResult = await spawnWait("docker", [
            "rm",
            "-f",
            session.webContainerId,
          ]);
          console.log(
            `   ${
              webResult.code === 0 ? "✅" : "⚠️"
            } Web container removal: exit code ${webResult.code}`
          );
        }

        if (session.projectVolumeName) {
          console.log(
            `   🗑️  Removing Docker volume: ${session.projectVolumeName}`
          );
          const volumeResult = await spawnWait("docker", [
            "volume",
            "rm",
            session.projectVolumeName,
          ]);
          console.log(
            `   ${
              volumeResult.code === 0 ? "✅" : "⚠️"
            } Volume removal: exit code ${volumeResult.code}`
          );
        }
      } catch (e) {
        console.error(`   ❌ Error during container cleanup: ${e.message}`);
      }

      // Cleanup ephemeral directory if created
      try {
        if (session.ephemeralDir) {
          console.log(
            `   🗑️  Removing ephemeral directory: ${session.ephemeralDir}`
          );
          fs.rmSync(session.ephemeralDir, { recursive: true, force: true });
          console.log(`   ✅ Ephemeral directory removed`);
        }
      } catch (e) {
        console.error(
          `   ❌ Failed to remove ephemeral directory: ${e.message}`
        );
      }

      console.log(`   ✅ Terminal session ${terminalId} cleanup completed`);
    } else {
      console.log(
        `   ⚠️  Terminal session ${terminalId} was not found in active sessions`
      );
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

    // Try to find project - first with owner, then fallback to name-only
    let proj = null;
    try {
      proj = await ProjectModel.findOne({
        owner: userId,
        name: projectName,
      }).lean();
    } catch (e) {
      console.log(`   ⚠️  Sync files owner-based lookup failed: ${e.message}`);
      try {
        proj = await ProjectModel.findOne({ name: projectName }).lean();
      } catch (e2) {
        console.log(`   ❌ Sync files name-only lookup failed: ${e2.message}`);
      }
    }

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
  console.log(
    `\n📂 [FILE POPULATION] Populating ${files.length} files in container ${containerId}`
  );

  let fileCount = 0;
  let folderCount = 0;
  let errorCount = 0;

  // Write folders/files directly inside container using docker exec + cat
  // Files expected to have fields: path, type ('file'|'folder'), content (for files)
  for (const f of files) {
    try {
      const rel = String(f.path || "").replace(/\\/g, "/");
      if (!rel) {
        console.warn(`   ⚠️  Skipping file with empty path`);
        continue;
      }

      if (f.type === "folder") {
        console.log(`   📁 Creating folder: ${rel}`);
        const result = await spawnWait("docker", [
          "exec",
          containerId,
          "sh",
          "-lc",
          `mkdir -p /workspace/${rel}`,
        ]);
        if (result.code === 0) {
          folderCount++;
          console.log(`   ✅ Folder created successfully`);
        } else {
          console.error(
            `   ❌ Failed to create folder: ${result.stderr || result.stdout}`
          );
          errorCount++;
        }
      } else {
        const dir = path.posix.dirname(`/workspace/${rel}`);
        console.log(
          `   📄 Creating file: ${rel} (${
            f.content ? f.content.length : 0
          } bytes)`
        );

        // Ensure parent directory exists
        await spawnWait("docker", [
          "exec",
          containerId,
          "sh",
          "-lc",
          `mkdir -p ${dir}`,
        ]);

        // Write file content
        await new Promise((resolve) => {
          const child = spawn(
            "docker",
            ["exec", "-i", containerId, "sh", "-lc", `cat > /workspace/${rel}`],
            { env: process.env, shell: false }
          );
          child.stdin.write(f.content || "");
          child.stdin.end();
          child.on("close", (code) => {
            if (code === 0) {
              fileCount++;
              console.log(`   ✅ File written successfully`);
            } else {
              console.error(`   ❌ Failed to write file (exit code: ${code})`);
              errorCount++;
            }
            resolve();
          });
          child.on("error", (err) => {
            console.error(`   ❌ File write error: ${err.message}`);
            errorCount++;
            resolve();
          });
        });
      }
    } catch (e) {
      console.error(`   ❌ Error processing ${f.path}: ${e.message}`);
      errorCount++;
    }
  }

  console.log(`   📊 Population summary:`);
  console.log(`      Files created: ${fileCount}`);
  console.log(`      Folders created: ${folderCount}`);
  console.log(`      Errors: ${errorCount}`);

  if (errorCount > 0) {
    console.warn(`   ⚠️  ${errorCount} errors occurred during file population`);
  } else {
    console.log(`   ✅ All files populated successfully`);
  }
};
