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
 * Simple Container Service for Temporary Workflow
 * - User selects project -> creates temporary container
 * - Files served temporarily from host directory
 * - Web projects get nginx on port 8088
 * - Container destroys when done (no persistence)
 */
class ContainerService {
  constructor() {
    this.activeContainers = new Map(); // containerId -> containerInfo
    this.activeSessions = new Map(); // terminalId -> sessionInfo
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
      candidates.push(
        path.join("C:", "Program Files", "PowerShell", "7", "pwsh.exe")
      );
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      return "cmd.exe";
    } catch (error) {
      return "cmd.exe";
    }
  }

  /**
   * Initialize temporary container session
   * Simple workflow: Load project -> Create temp directory -> Start container
   */
  async initializeTerminalSession(terminalId, projectName, ownerId) {
    console.log(`🚀 Initializing temporary container session...`);
    console.log(`   📋 Terminal ID: ${terminalId}`);
    console.log(`   👤 Owner: ${ownerId}`);
    console.log(`   📁 Project: ${projectName}`);

    const projectPath = this.getProjectPath(projectName, ownerId);
    let tempDir = null;

    try {
      // Check if project exists in database
      const { Project: ProjectModel, File: FileModel } = getModels();

      if (config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
        console.log(`   🔍 Looking up project in database...`);

        let dbProject = await ProjectModel.findOne({
          name: projectName,
          owner: ownerId,
        }).lean();

        if (!dbProject) {
          // Fallback to name-only search
          dbProject = await ProjectModel.findOne({ name: projectName }).lean();
        }

        if (dbProject) {
          console.log(`   ✅ Project found in database (ID: ${dbProject._id})`);

          // Create temporary directory for this session
          tempDir = fs.mkdtempSync(
            path.join(os.tmpdir(), `devdock-${projectName}-`)
          );
          console.log(`   📂 Created temp directory: ${tempDir}`);

          // Load all files from database
          const allFiles = await FileModel.find({
            project: dbProject._id,
          }).lean();
          console.log(
            `   📄 Loading ${allFiles.length} files from database...`
          );

          // Materialize files to temp directory
          let fileCount = 0;
          let folderCount = 0;

          for (const file of allFiles) {
            const targetPath = path.join(tempDir, file.path);

            if (file.type === "folder") {
              fs.mkdirSync(targetPath, { recursive: true });
              folderCount++;
            } else {
              fs.mkdirSync(path.dirname(targetPath), { recursive: true });
              fs.writeFileSync(targetPath, file.content || "", "utf8");
              fileCount++;
            }
          }

          console.log(
            `   ✅ Materialized ${fileCount} files and ${folderCount} folders`
          );

          // Use temp directory as project path
          projectPath = tempDir;
        } else {
          console.log(`   ⚠️  Project '${projectName}' not found in database`);
          console.log(`   📁 Using filesystem path: ${projectPath}`);
          await this.ensureProjectExists(projectPath);
        }
      } else {
        console.log(`   📁 Using filesystem storage (database disabled)`);
        await this.ensureProjectExists(projectPath);
      }
    } catch (error) {
      console.error(`   ❌ Error loading project: ${error.message}`);
      // Fallback to filesystem
      await this.ensureProjectExists(projectPath);
    }

    // Get container image based on project files
    const image = await this.getProjectImage(projectPath);
    console.log(`   🐳 Selected image: ${image}`);

    // Ensure image exists
    if (!(await dockerImageExists(image))) {
      console.log(`   ⬇️  Pulling image: ${image}`);
      await dockerPullImage(image);
    }

    // Create container
    const containerId = this.makeContainerName(
      projectName,
      ownerId,
      terminalId
    );
    console.log(`   🏷️  Container name: ${containerId}`);

    // Get free port for internal services
    const mappedPort = await this.getFreePort();
    console.log(`   🔌 Allocated port: ${mappedPort} -> 8080`);

    // Start container with simple host directory mount
    console.log(`   🐳 Starting container...`);
    console.log(`      Host directory: ${projectPath}`);
    console.log(`      Container mount: /workspace`);

    const dockerArgs = [
      "run",
      "-dit",
      "--name",
      containerId,
      "-v",
      `${projectPath}:/workspace`,
      "-w",
      "/workspace",
      "-p",
      `${mappedPort}:8080`,
      image,
      "bash",
    ];

    console.log(`   💻 Docker command: docker ${dockerArgs.join(" ")}`);
    const result = await spawnWait("docker", dockerArgs);

    if (result.code !== 0) {
      console.error(`   ❌ Container creation failed!`);
      console.error(`      Error: ${result.stderr || result.stdout}`);

      // Clean up temp directory if created
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      throw new Error(
        `Container creation failed: ${result.stderr || result.stdout}`
      );
    }

    console.log(`   ✅ Container started successfully!`);

    // Store session information
    const sessionInfo = {
      terminalId,
      ownerId,
      projectName,
      projectPath,
      tempDir, // Track temp directory for cleanup
      imageName: image,
      containerId,
      mappedPort,
      created: new Date(),
    };

    this.activeSessions.set(terminalId, sessionInfo);
    this.activeContainers.set(containerId, sessionInfo);

    console.log(`   📊 Session registered in memory`);
    return sessionInfo;
  }

  /**
   * Start web server for project (simple nginx on port 8088)
   */
  async startWebServer(terminalId) {
    console.log(`🌐 Starting web server for session ${terminalId}...`);

    const session = this.activeSessions.get(terminalId);
    if (!session) {
      console.error(`   ❌ Session not found: ${terminalId}`);
      return { code: -1, error: "SESSION_NOT_FOUND" };
    }

    const webContainerName = `${session.containerId}-web`;
    const webPort = 8088; // Fixed port as per requirements

    console.log(`   🏷️  Web container name: ${webContainerName}`);
    console.log(`   🔌 Web port: ${webPort}`);

    // Check if web server already running
    const existingCheck = await spawnWait("docker", [
      "ps",
      "-q",
      "-f",
      `name=${webContainerName}`,
    ]);
    if (existingCheck.code === 0 && existingCheck.stdout.trim()) {
      console.log(`   ⚠️  Web server already running`);
      return {
        code: 0,
        url: `http://localhost:${webPort}`,
        webPort,
        info: { projectName: session.projectName, status: "already_running" },
      };
    }

    // Check port availability
    try {
      await this.checkPortAvailable(webPort);
      console.log(`   ✅ Port ${webPort} is available`);
    } catch (error) {
      console.error(`   ❌ Port ${webPort} is in use`);
      return { code: -1, webPort, error: "PORT_IN_USE" };
    }

    // Start nginx container with simple host mount
    console.log(`   🐳 Starting nginx container...`);
    console.log(`      Host directory: ${session.projectPath}`);
    console.log(`      Nginx mount: /usr/share/nginx/html`);

    const nginxArgs = [
      "run",
      "-d",
      "--rm",
      "--name",
      webContainerName,
      "-p",
      `0.0.0.0:${webPort}:80`,
      "-v",
      `${session.projectPath}:/usr/share/nginx/html:ro`,
      "nginx:alpine",
    ];

    console.log(`   💻 Nginx command: docker ${nginxArgs.join(" ")}`);
    const result = await spawnWait("docker", nginxArgs);

    if (result.code !== 0) {
      console.error(`   ❌ Web server failed to start!`);
      console.error(`      Error: ${result.stderr || result.stdout}`);
      return {
        code: result.code,
        webPort,
        error: result.stderr || result.stdout,
      };
    }

    console.log(`   ✅ Web server started successfully!`);
    console.log(`   🌍 URL: http://localhost:${webPort}`);

    // Store web container info in session
    session.webContainerName = webContainerName;
    session.webPort = webPort;

    return {
      code: 0,
      url: `http://localhost:${webPort}`,
      webPort,
      info: {
        projectName: session.projectName,
        status: "started",
        containerName: webContainerName,
      },
    };
  }

  /**
   * Cleanup session - destroy containers and temp files
   */
  async cleanupSession(terminalId) {
    console.log(`🧹 Cleaning up session ${terminalId}...`);

    const session = this.activeSessions.get(terminalId);
    if (!session) {
      console.log(`   ⚠️  Session not found: ${terminalId}`);
      return;
    }

    // Stop and remove main container
    if (session.containerId) {
      console.log(`   🛑 Stopping container: ${session.containerId}`);
      await spawnWait("docker", ["stop", session.containerId]).catch(() => {});
      await spawnWait("docker", ["rm", "-f", session.containerId]).catch(
        () => {}
      );
    }

    // Stop and remove web container
    if (session.webContainerName) {
      console.log(`   🛑 Stopping web container: ${session.webContainerName}`);
      await spawnWait("docker", ["stop", session.webContainerName]).catch(
        () => {}
      );
      await spawnWait("docker", ["rm", "-f", session.webContainerName]).catch(
        () => {}
      );
    }

    // Clean up temporary directory
    if (session.tempDir && fs.existsSync(session.tempDir)) {
      console.log(`   🗑️  Removing temp directory: ${session.tempDir}`);
      fs.rmSync(session.tempDir, { recursive: true, force: true });
    }

    // Remove from tracking
    this.activeSessions.delete(terminalId);
    if (session.containerId) {
      this.activeContainers.delete(session.containerId);
    }

    console.log(`   ✅ Session cleanup completed`);
  }

  /**
   * Helper methods
   */
  async checkPortAvailable(port) {
    return new Promise((resolve, reject) => {
      const server = net.createServer();

      server.once("error", (err) => {
        reject(err);
      });

      server.once("listening", () => {
        server.close(() => {
          resolve(true);
        });
      });

      server.listen(port);
    });
  }

  async getFreePort() {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(0, () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
  }

  getProjectPath(projectName, ownerId) {
    const projectsDir = path.join(process.cwd(), "projects");
    return path.join(projectsDir, ownerId, projectName);
  }

  makeContainerName(projectName, ownerId, terminalId) {
    const safeName = projectName.replace(/[^a-zA-Z0-9-]/g, "-");
    const shortTerminal = terminalId.slice(-8);
    return `devdock-${ownerId}-${safeName}-${shortTerminal}`;
  }

  async ensureProjectExists(projectPath) {
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });

      // Create a simple index.html if it's an empty project
      const indexPath = path.join(projectPath, "index.html");
      if (!fs.existsSync(indexPath)) {
        const defaultContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DevDock Project</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 2rem; }
        .container { max-width: 800px; margin: 0 auto; }
        h1 { color: #333; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🐳 DevDock Project</h1>
        <p>Welcome to your temporary containerized development environment!</p>
        <p>This project is running in a Docker container with nginx serving on port 8088.</p>
    </div>
</body>
</html>`;
        fs.writeFileSync(indexPath, defaultContent);
      }
    }
  }

  async getProjectImage(projectPath) {
    // Simple image detection based on files present
    const files = fs.readdirSync(projectPath).map((f) => f.toLowerCase());

    if (files.includes("package.json")) {
      return "node:20-alpine";
    } else if (files.some((f) => f.endsWith(".py"))) {
      return "python:3.11-slim";
    } else if (files.some((f) => f.endsWith(".java"))) {
      return "eclipse-temurin:17-jdk";
    } else if (files.some((f) => f.endsWith(".c") || f.endsWith(".cpp"))) {
      return "gcc:12";
    } else {
      return "node:20-alpine"; // Default
    }
  }

  // Additional methods for compatibility with existing code
  async startTerminalSession(terminalId, projectName, ownerId) {
    return this.initializeTerminalSession(terminalId, projectName, ownerId);
  }

  async stopTerminalSession(terminalId) {
    return this.cleanupSession(terminalId);
  }

  async executeCommand(terminalId, command) {
    const session = this.activeSessions.get(terminalId);
    if (!session) {
      throw new Error(`Session not found: ${terminalId}`);
    }

    const dockerArgs = [
      "exec",
      "-i",
      session.containerId,
      "bash",
      "-c",
      command,
    ];
    return spawnWait("docker", dockerArgs);
  }
}

module.exports = ContainerService;
