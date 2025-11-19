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
 * ContainerService - Manages Docker containers for project execution
 * Handles container lifecycle, web serving, file synchronization, and auto-restart
 */
class ContainerService {
  constructor() {
    this.activeContainers = new Map(); // containerId -> containerInfo
    this.activeSessions = new Map(); // terminalId -> sessionInfo
    this.windowsShell = this.detectWindowsShell();
    this.stateFile = path.join(os.tmpdir(), "devdock-container-state.json");

    // Load persistent state on startup
    this.loadState();
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
   * Load container state from disk to recover from server restarts
   */
  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const stateData = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
        console.log("🔄 Loading container state from disk...");

        // Verify containers are still running and restore state
        this.verifyAndRestoreContainers(stateData);
      }
    } catch (error) {
      console.log(`⚠️  Error loading container state: ${error.message}`);
    }
  }

  /**
   * Save current container state to disk
   */
  saveState() {
    try {
      const stateData = {
        sessions: Array.from(this.activeSessions.entries()).map(
          ([id, session]) => [
            id,
            {
              ...session,
              created: session.created.toISOString(),
            },
          ]
        ),
        containers: Array.from(this.activeContainers.entries()),
        timestamp: new Date().toISOString(),
      };

      fs.writeFileSync(this.stateFile, JSON.stringify(stateData, null, 2));
    } catch (error) {
      console.log(`⚠️  Error saving container state: ${error.message}`);
    }
  }

  /**
   * Verify containers are still running and restore valid sessions
   */
  async verifyAndRestoreContainers(stateData) {
    let restoredCount = 0;

    try {
      for (const [terminalId, sessionData] of stateData.sessions || []) {
        // Convert created date back from ISO string
        if (sessionData.created && typeof sessionData.created === "string") {
          sessionData.created = new Date(sessionData.created);
        }

        // Check if container is still running
        if (sessionData.containerId) {
          const isRunning = await this.isContainerRunning(
            sessionData.containerId
          );
          if (isRunning) {
            console.log(
              `   ✅ Restored session: ${terminalId} -> ${sessionData.containerId}`
            );
            this.activeSessions.set(terminalId, sessionData);
            this.activeContainers.set(sessionData.containerId, sessionData);
            restoredCount++;
          } else {
            console.log(
              `   🗑️  Container ${sessionData.containerId} no longer running, skipping`
            );
          }
        }
      }

      if (restoredCount > 0) {
        console.log(`🎉 Restored ${restoredCount} active container sessions`);
      }
    } catch (error) {
      console.log(`⚠️  Error verifying containers: ${error.message}`);
    }
  }

  /**
   * Check if a container is still running
   */
  async isContainerRunning(containerId) {
    try {
      const result = await spawnWait("docker", [
        "ps",
        "-q",
        "-f",
        `name=^${containerId}$`,
      ]);
      return result.code === 0 && result.stdout.trim().length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Ensure database is ready for use
   */
  async ensureDatabaseReady() {
    if (!config.USE_DB_PROJECTS_BOOL) {
      return false; // Database not needed
    }

    const { ProjectModel, FileModel } = getModels();
    if (ProjectModel && FileModel) {
      return true; // Database is ready
    }

    // Wait a moment for database to initialize
    console.log(`   ⏳ Waiting for database to initialize...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const { ProjectModel: ProjectModel2, FileModel: FileModel2 } = getModels();
    return !!(ProjectModel2 && FileModel2);
  }

  /**
   * Initialize temporary container session
   * Simple workflow: Load project -> Create temp directory -> Start container
   */
  /**
   * Initialize temporary container session - Load project files and create isolated container
   */
  async initializeTerminalSession(terminalId, projectName, ownerId) {
    console.log(`🚀 Initializing temporary container session...`);
    console.log(`   📋 Terminal ID: ${terminalId}`);
    console.log(`   👤 Owner: ${ownerId}`);
    console.log(`   📁 Project: ${projectName}`);

    const projectPath = this.getProjectPath(projectName, ownerId);
    let actualProjectPath = projectPath; // This will be updated if we use MongoDB
    let tempDir = null;

    try {
      // Ensure database is ready if needed
      const dbReady = await this.ensureDatabaseReady();

      if (dbReady) {
        const { ProjectModel, FileModel } = getModels();
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

          // Use temp directory as project path for container and web server
          actualProjectPath = tempDir;
          console.log(
            `   📂 Using MongoDB temp directory: ${actualProjectPath}`
          );
        } else {
          console.log(`   ⚠️  Project '${projectName}' not found in database`);
          console.log(`   📁 Using filesystem path: ${actualProjectPath}`);
          await this.ensureProjectExists(actualProjectPath);
        }
      } else {
        console.log(`   📁 Using filesystem storage (database disabled)`);
        await this.ensureProjectExists(actualProjectPath);
      }
    } catch (error) {
      console.error(`   ❌ Error loading project: ${error.message}`);
      // Fallback to filesystem
      await this.ensureProjectExists(actualProjectPath);
    }

    // Get container image based on project files
    const image = await this.getProjectImage(actualProjectPath);
    console.log(`   🐳 Selected image: ${image}`);

    // Ensure image exists
    if (!(await dockerImageExists(image))) {
      console.log(`   ⬇️  Pulling image: ${image}`);
      await dockerPullImage(image);
    }

    // Create container with cleanup and unique naming
    const baseContainerId = this.makeContainerName(
      projectName,
      ownerId,
      terminalId
    );
    console.log(`   🏷️  Base container name: ${baseContainerId}`);

    // Clean up any existing containers with the same name
    await this.cleanupExistingContainer(baseContainerId);

    // Ensure unique container name
    const containerId = await this.ensureUniqueContainerName(baseContainerId);
    console.log(`   🏷️  Final container name: ${containerId}`);

    // Get free port for internal services
    const mappedPort = await this.getFreePort();
    console.log(`   🔌 Allocated port: ${mappedPort} -> 8080`);

    // Start container with simple host directory mount
    console.log(`   🐳 Starting container...`);
    console.log(`      Host directory: ${actualProjectPath}`);
    console.log(`      Container mount: /workspace`);

    const dockerArgs = [
      "run",
      "-dit",
      "--name",
      containerId,
      "-v",
      `${actualProjectPath}:/workspace`,
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
      projectPath: actualProjectPath, // Use the actual path (temp dir for MongoDB projects)
      tempDir, // Track temp directory for cleanup
      imageName: image,
      containerId,
      mappedPort,
      projectType: image, // For compatibility with socket handlers
      workingDirectory: "/workspace", // Default working directory
      created: new Date(),
    };

    this.activeSessions.set(terminalId, sessionInfo);
    this.activeContainers.set(containerId, sessionInfo);

    console.log(`   📊 Session registered in memory`);

    // Save state to disk for server restart recovery
    this.saveState();

    return sessionInfo;
  }

  /**
   * Start web server for project (simple nginx on port 8088)
   */
  /**
   * Start nginx web server for project with fresh container and port allocation
   */
  async startWebServer(terminalId) {
    console.log(`🌐 Starting web server for session ${terminalId}...`);

    const session = this.activeSessions.get(terminalId);
    if (!session) {
      console.error(`   ❌ Session not found: ${terminalId}`);
      return { code: -1, error: "SESSION_NOT_FOUND" };
    }

    // Create unique container name with timestamp to prevent caching
    const timestamp = Date.now();
    const webContainerName = `${session.containerId}-web-${timestamp}`;
    // Use the same port as the container was using
    const webPort = session.mappedPort;

    console.log(`   🏷️  Web container name: ${webContainerName}`);
    console.log(`   🔌 Web port: ${webPort} (reusing container's port)`);

    // Stop the development container first to free up the port
    console.log(`   🛑 Stopping development container to free port...`);
    try {
      const stopResult = await spawnWait("docker", [
        "stop",
        session.containerId,
      ]);
      if (stopResult.code === 0) {
        console.log(`   ✅ Development container stopped`);
      } else {
        console.log(`   ⚠️  Container stop returned code ${stopResult.code}`);
      }
    } catch (error) {
      // Container might already be stopped or removed
      if (
        error.message.includes("No such container") ||
        error.message.includes("is not running")
      ) {
        console.log(`   ✅ Development container already stopped`);
      } else {
        console.log(`   ⚠️  Container stop error: ${error.message}`);
      }
    }

    // DESTROY ALL old web containers for this session (aggressive cleanup)
    console.log(`   🧹 Destroying ALL old web containers for session...`);
    const baseContainerName = session.containerId;

    try {
      // Find and destroy all containers with this session's base name + "-web"
      const listResult = await spawnWait("docker", [
        "ps",
        "-a",
        "--format",
        "{{.Names}}",
        "--filter",
        `name=${baseContainerName}-web`,
      ]);

      if (listResult.code === 0 && listResult.stdout.trim()) {
        const oldContainers = listResult.stdout
          .trim()
          .split("\n")
          .filter((name) => name.trim());
        console.log(
          `   🎯 Found ${
            oldContainers.length
          } old containers to destroy: ${oldContainers.join(", ")}`
        );

        for (const containerName of oldContainers) {
          try {
            await spawnWait("docker", ["stop", containerName]);
            await spawnWait("docker", ["rm", "-f", containerName]);
            console.log(`   💥 Destroyed: ${containerName}`);
          } catch (destroyError) {
            console.log(
              `   ⚠️  Could not destroy ${containerName}: ${destroyError.message}`
            );
          }
        }
      }
      console.log(`   ✅ All old web containers destroyed!`);
    } catch (cleanupError) {
      console.log(`   ⚠️  Cleanup error: ${cleanupError.message}`);
    }

    console.log(`   ✅ Port ${webPort} available after cleanup`);

    // Start nginx container with simple host mount
    console.log(`   🐳 Starting nginx container with fresh cache...`);
    console.log(`      Host directory: ${session.projectPath}`);
    console.log(`      Nginx mount: /usr/share/nginx/html`);

    // Detect project type based on files
    const files = fs.readdirSync(session.projectPath);
    const hasHtmlFile = files.some(
      (file) => file.endsWith(".html") || file.endsWith(".htm")
    );
    const hasIndexJs = files.includes("index.js");

    console.log(`   🔍 Project files: ${files.join(", ")}`);
    console.log(`   🌐 Has HTML files: ${hasHtmlFile ? "YES" : "NO"}`);
    console.log(`   📄 Has index.js: ${hasIndexJs ? "YES" : "NO"}`);

    // Create nginx config with smart project handling
    let nginxConfigContent;

    if (hasHtmlFile) {
      // Standard web project configuration
      nginxConfigContent = `
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html index.htm;
    
    # Disable all caching
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
        add_header Pragma "no-cache";
        add_header Expires "0";
        etag off;
    }
    
    # Disable caching for all file types
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
        add_header Pragma "no-cache";
        add_header Expires "0";
        etag off;
    }
}
`;
    } else if (hasIndexJs) {
      // Node.js project - serve index.js as main file
      nginxConfigContent = `
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.js index.html index.htm;
    
    # Disable all caching
    location / {
        try_files $uri $uri/ @directory_listing;
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
        add_header Pragma "no-cache";
        add_header Expires "0";
        etag off;
    }
    
    # Enable directory browsing for code projects
    location @directory_listing {
        autoindex on;
        autoindex_exact_size off;
        autoindex_localtime on;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }
    
    # Serve JavaScript files with proper content type
    location ~* \.js$ {
        add_header Content-Type "text/plain; charset=utf-8";
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }
    
    # Serve source files with proper content type
    location ~* \.(c|cpp|h|hpp|py|java)$ {
        add_header Content-Type "text/plain; charset=utf-8";
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }
}
`;
    } else {
      // Source code project - enable directory browsing
      nginxConfigContent = `
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    
    # Enable directory browsing for source code projects
    location / {
        autoindex on;
        autoindex_exact_size off;
        autoindex_localtime on;
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
        add_header Pragma "no-cache";
        add_header Expires "0";
        etag off;
    }
    
    # Serve source files with proper content type for viewing
    location ~* \.(c|cpp|h|hpp|py|java|js|ts|css|txt|md|json|xml|yml|yaml)$ {
        add_header Content-Type "text/plain; charset=utf-8";
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }
    
    # Serve images and other binary files normally
    location ~* \.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|pdf)$ {
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }
}
`;
    }

    // Write nginx config to temp directory with unique name
    const nginxConfigPath = path.join(
      session.projectPath,
      `.nginx-${timestamp}.conf`
    );
    fs.writeFileSync(nginxConfigPath, nginxConfigContent);
    console.log(`   📝 Created fresh nginx config: .nginx-${timestamp}.conf`);

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
      "-v",
      `${nginxConfigPath}:/etc/nginx/conf.d/default.conf:ro`,
      "nginx:alpine",
    ];

    console.log(
      `   🔥 Creating COMPLETELY FRESH container: ${webContainerName}`
    );
    console.log(`   📁 Mount: ${session.projectPath} -> /usr/share/nginx/html`);
    console.log(
      `   ⚙️  Config: ${nginxConfigPath} -> /etc/nginx/conf.d/default.conf`
    );

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

    // Save updated state to disk
    this.saveState();
  }

  /**
   * Clean up existing container with the same name
   */
  async cleanupExistingContainer(containerName) {
    try {
      // Check if container exists
      const checkResult = await spawnWait("docker", [
        "ps",
        "-a",
        "-q",
        "-f",
        `name=^${containerName}$`,
      ]);

      if (checkResult.stdout.trim()) {
        console.log(`   🧹 Found existing container: ${containerName}`);
        console.log(`   🛑 Stopping and removing existing container...`);

        // Stop container (ignore errors)
        await spawnWait("docker", ["stop", containerName]).catch(() => {});

        // Remove container (ignore errors)
        await spawnWait("docker", ["rm", "-f", containerName]).catch(() => {});

        console.log(`   ✅ Existing container cleaned up`);
      }
    } catch (error) {
      console.log(`   ⚠️  Container cleanup warning: ${error.message}`);
    }
  }

  /**
   * Ensure container name is unique by adding suffix if needed
   */
  async ensureUniqueContainerName(baseName) {
    let containerName = baseName;
    let attempt = 1;

    while (attempt <= 5) {
      try {
        // Check if this name is in use
        const checkResult = await spawnWait("docker", [
          "ps",
          "-a",
          "-q",
          "-f",
          `name=^${containerName}$`,
        ]);

        if (!checkResult.stdout.trim()) {
          // Name is available
          return containerName;
        }

        // Name is taken, try with suffix
        containerName = `${baseName}-${attempt}`;
        attempt++;
      } catch (error) {
        // If check fails, assume name is available
        return containerName;
      }
    }

    // After 5 attempts, add timestamp
    return `${baseName}-${Date.now()}`;
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
    const safeName = String(projectName || "unknown").replace(
      /[^a-zA-Z0-9-]/g,
      "-"
    );
    const safeOwner = String(ownerId || "user");
    const safeTerminal = String(terminalId || Date.now());
    const shortTerminal = safeTerminal.slice(-8);
    return `devdock-${safeOwner}-${safeName}-${shortTerminal}`;
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

  async executeCommand(terminalId, command, options = {}) {
    let session = this.activeSessions.get(terminalId);
    if (!session) {
      throw new Error(
        `Session not found: ${terminalId}. Please reinitialize the terminal.`
      );
    }

    // Verify container is still running before executing command
    if (session.containerId) {
      const isRunning = await this.isContainerRunning(session.containerId);
      if (!isRunning) {
        console.log(
          `⚠️  Container ${session.containerId} is no longer running. Auto-recovering...`
        );

        // AUTO-RECOVERY: Recreate the session with the same terminal ID
        try {
          console.log(`🔄 Auto-recovering session: ${terminalId}`);
          const hadWebServer = session.webContainerName || session.webPort;

          // Store session info for recreation
          const sessionInfo = {
            projectName: session.projectName,
            ownerId: session.ownerId,
          };

          // Clean up dead session
          this.activeSessions.delete(terminalId);
          this.activeContainers.delete(session.containerId);
          this.saveState();

          // Recreate session with same terminal ID
          const newSession = await this.initializeTerminalSession(
            terminalId,
            sessionInfo.projectName,
            sessionInfo.ownerId
          );

          // Restart web server if it was running
          if (hadWebServer) {
            try {
              await this.startWebServer(terminalId);
              console.log(`🌐 Auto-recovered web server for ${terminalId}`);
            } catch (webError) {
              console.log(
                `⚠️  Web server auto-recovery failed: ${webError.message}`
              );
            }
          }

          // Update session reference and verify it's properly stored
          session = newSession;

          // Double-check the session is properly stored in activeSessions and get fresh reference
          session = this.activeSessions.get(terminalId);
          if (!session) {
            throw new Error(
              `Failed to retrieve recovered session for ${terminalId}`
            );
          }

          console.log(
            `🔍 Session verification: container=${session.containerId}, project=${session.projectName}`
          );

          // Notify frontend about auto-recovery
          if (options.socket) {
            options.socket.emit("terminal-output", {
              terminalId,
              output: `🔄 Container was restarted automatically. Ready for commands!\n`,
            });

            options.socket.emit("container-recovered", {
              terminalId,
              message: "Container auto-recovered successfully",
              timestamp: new Date().toISOString(),
            });
          }

          console.log(`✅ Auto-recovery completed for session: ${terminalId}`);
        } catch (recoveryError) {
          console.error(`❌ Auto-recovery failed: ${recoveryError.message}`);
          throw new Error(
            `Container ${session.containerId} is not running and auto-recovery failed: ${recoveryError.message}. Please restart the terminal session.`
          );
        }
      }
    }

    const { onStdout, onStderr, onProcess, socket } = options;

    // Use session's current working directory
    const currentWorkingDir = session.workingDirectory || "/workspace";

    // Check if this is a directory change command
    const isCdCommand = command.trim().match(/^cd(\\s|$)/);

    // For all commands, we'll execute them with PWD tracking to maintain directory state
    let actualCommand = command;
    if (isCdCommand) {
      // For cd commands, handle them specially
      const cdTarget = command.replace(/^cd\\s*/, "").trim();
      const cdPath = cdTarget || "~";
      // Execute cd and then get PWD to track directory change
      actualCommand = `cd "${cdPath}" 2>/dev/null && pwd || (echo "cd: ${cdPath}: No such file or directory" >&2; echo "${currentWorkingDir}")`;
    } else {
      // For non-cd commands, execute normally but also get PWD to maintain state
      actualCommand = `${command}; echo "__PWD_MARKER__"; pwd`;
    }

    const dockerArgs = [
      "exec",
      "-i",
      "-w",
      currentWorkingDir,
      session.containerId,
      "bash",
      "-c",
      actualCommand,
    ];

    if (onProcess) {
      // For streaming execution
      const { spawn } = require("child_process");
      const child = spawn("docker", dockerArgs);
      onProcess(child);

      let commandOutput = "";

      if (onStdout) {
        child.stdout.on("data", (data) => {
          const dataStr = data.toString();
          commandOutput += dataStr;
          onStdout(dataStr);
        });
      }
      if (onStderr) {
        child.stderr.on("data", (data) => {
          const dataStr = data.toString();
          commandOutput += dataStr;
          onStderr(dataStr);
        });
      }

      return new Promise(async (resolve) => {
        child.on("close", async (code) => {
          let newWorkingDirectory = currentWorkingDir;
          let cleanOutput = commandOutput;

          // Extract PWD from output and clean it
          if (isCdCommand) {
            // For cd commands, the last line should be the new directory
            const lines = commandOutput.trim().split("\\n");
            const lastLine = lines[lines.length - 1].trim();
            if (lastLine.startsWith("/")) {
              newWorkingDirectory = lastLine;
              session.workingDirectory = newWorkingDirectory;
              console.log(
                `   📁 Working directory changed to: ${newWorkingDirectory}`
              );
              // Remove PWD from output for cd commands
              cleanOutput = lines.slice(0, -1).join("\\n");
            }
          } else {
            // For non-cd commands, extract PWD after the marker
            const pwdMarkerIndex = commandOutput.lastIndexOf("__PWD_MARKER__");
            if (pwdMarkerIndex !== -1) {
              const afterMarker = commandOutput
                .substring(pwdMarkerIndex + "__PWD_MARKER__".length)
                .trim();
              const lines = afterMarker.split("\\n");
              const firstLine = lines[0].trim();
              if (firstLine.startsWith("/")) {
                newWorkingDirectory = firstLine;
                session.workingDirectory = newWorkingDirectory;
              }
              // Remove PWD marker and output from the command output
              cleanOutput = commandOutput.substring(0, pwdMarkerIndex);
            }

            // For file-modifying commands, immediately sync to MongoDB
            const fileModifyCommands =
              /^(mkdir|rmdir|rm|mv|cp|touch|nano|vim|vi|emacs|tee|echo)(\\s|$)/i;
            const isFileModifying =
              fileModifyCommands.test(command.trim()) ||
              command.includes(">") ||
              command.includes(">>") ||
              command.includes("tee");

            if (isFileModifying) {
              console.log(`🔄 File-modifying command detected: ${command}`);
              await this.syncContainerToHost(session, command);
              await this.notifyFileTreeUpdate(session, socket);
            }
          }

          resolve({
            code,
            workingDirectory: newWorkingDirectory,
            output: cleanOutput,
          });
        });
      });
    } else {
      // For simple execution
      const result = await spawnWait("docker", dockerArgs);
      let newWorkingDirectory = currentWorkingDir;

      // Handle cd command results
      if (isCdCommand) {
        // Extract new working directory from pwd output (always the last line)
        const lines = result.stdout.trim().split("\\n");
        const lastLine = lines[lines.length - 1].trim();
        if (lastLine.startsWith("/")) {
          newWorkingDirectory = lastLine;
          session.workingDirectory = newWorkingDirectory;
          console.log(
            `   📁 Working directory changed to: ${newWorkingDirectory}`
          );
          // Clean output for cd commands - remove the PWD line
          result.stdout = lines.slice(0, -1).join("\\n");
        }
      } else {
        // Extract PWD from output for directory tracking
        const pwdMarkerIndex = result.stdout.lastIndexOf("__PWD_MARKER__");
        if (pwdMarkerIndex !== -1) {
          const afterMarker = result.stdout
            .substring(pwdMarkerIndex + "__PWD_MARKER__".length)
            .trim();
          const lines = afterMarker.split("\n");
          const firstLine = lines[0].trim();
          if (firstLine.startsWith("/")) {
            newWorkingDirectory = firstLine;
            session.workingDirectory = newWorkingDirectory;
          }
          // Clean the output
          result.stdout = result.stdout.substring(0, pwdMarkerIndex);
        }

        // For file-modifying commands, immediately sync to MongoDB
        const fileModifyCommands =
          /^(mkdir|rmdir|rm|mv|cp|touch|nano|vim|vi|emacs|tee|echo)(\s|$)/i;
        const isFileModifying =
          fileModifyCommands.test(command.trim()) ||
          command.includes(">") ||
          command.includes(">>") ||
          command.includes("tee");

        if (isFileModifying) {
          console.log(`🔄 File-modifying command detected: ${command}`);
          await this.syncContainerToHost(session, command);
          await this.notifyFileTreeUpdate(session, socket);
        }
      }

      return {
        code: result.code,
        workingDirectory: newWorkingDirectory,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }
  }

  // Web interface compatibility methods
  getContainerUrl(containerInfo) {
    if (!containerInfo) return null;
    return `http://localhost:${containerInfo.mappedPort || 8080}`;
  }

  /**
   * Sync updated file to container when file changes are detected
   */
  async notifyFileChange(terminalId, filePath) {
    const session = this.activeSessions.get(terminalId);
    if (session) {
      console.log(`🔔 File change notification: ${filePath}`);
      // File changes are now handled by auto-restart, so just log
      console.log(
        `   ℹ️  Auto-restart will handle file sync for ${terminalId}`
      );
    }
  }

  // Notify frontend about file tree changes
  async notifyFileTreeUpdate(session, socket) {
    try {
      console.log(`🌳 Notifying frontend of file tree changes...`);

      if (socket) {
        // Emit file tree refresh event to the project room
        socket.to(session.projectName).emit("file-tree-update", {
          projectName: session.projectName,
          timestamp: new Date().toISOString(),
        });

        // Also emit to the current socket
        socket.emit("file-tree-update", {
          projectName: session.projectName,
          timestamp: new Date().toISOString(),
        });

        console.log(
          `   ✅ File tree update notification sent for project: ${session.projectName}`
        );
      } else {
        console.log(`   ⚠️  Socket instance not available`);
      }
    } catch (error) {
      console.log(`   ⚠️  Error notifying file tree update: ${error.message}`);
    }
  }

  updateTerminalWorkingDirectory(terminalId, workingDirectory) {
    const session = this.activeSessions.get(terminalId);
    if (session) {
      session.workingDirectory = workingDirectory;
      console.log(
        `   📁 Updated working directory for ${terminalId}: ${workingDirectory}`
      );
    }
  }

  getSession(terminalId) {
    return this.activeSessions.get(terminalId);
  }

  getWebInfo(terminalId) {
    const session = this.activeSessions.get(terminalId);
    if (!session) return null;
    return {
      webPort: session.webPort || 8088,
      webContainerName: session.webContainerName,
      url: session.webPort ? `http://localhost:${session.webPort}` : null,
    };
  }

  getUserTerminalSessions(userId) {
    const userTerminals = [];
    for (const [terminalId, session] of this.activeSessions) {
      if (session.ownerId === userId) {
        userTerminals.push(terminalId);
      }
    }
    return userTerminals;
  }

  getUserContainers(userId) {
    const userContainers = [];
    for (const [containerId, session] of this.activeContainers) {
      if (session.ownerId === userId) {
        userContainers.push({ containerId, session });
      }
    }
    return userContainers;
  }

  async stopContainer(containerId) {
    try {
      console.log(`   🛑 Stopping container: ${containerId}`);
      await spawnWait("docker", ["stop", containerId]).catch(() => {});
      await spawnWait("docker", ["rm", "-f", containerId]).catch(() => {});

      // Remove from tracking
      this.activeContainers.delete(containerId);

      // Find and remove session by containerId
      for (const [terminalId, session] of this.activeSessions) {
        if (session.containerId === containerId) {
          this.activeSessions.delete(terminalId);
          break;
        }
      }
    } catch (error) {
      console.error(
        `   ❌ Error stopping container ${containerId}:`,
        error.message
      );
    }
  }

  /**
   * Recreate a session with the same terminal ID (for auto-restart)
   */
  async recreateSession(
    terminalId,
    projectName,
    ownerId,
    preserveWebServer = false
  ) {
    console.log(
      `🔄 Recreating session: ${terminalId} for project: ${projectName}`
    );

    // Store current session info if it exists
    const currentSession = this.activeSessions.get(terminalId);
    const hadWebServer =
      currentSession?.webContainerName || currentSession?.webPort;

    // Clean up existing session
    if (currentSession) {
      await this.cleanupSession(terminalId);
    }

    // Create new session
    const newSession = await this.initializeTerminalSession(
      terminalId,
      projectName,
      ownerId
    );

    // Restart web server if it was running before
    if (preserveWebServer && hadWebServer) {
      console.log(`🌐 Restarting web server for recreated session...`);
      try {
        await this.startWebServer(terminalId);
        console.log(`✅ Web server restarted for session: ${terminalId}`);
      } catch (webError) {
        console.log(`⚠️  Web server restart failed: ${webError.message}`);
      }
    }

    return newSession;
  }

  /**
   * Auto-restart all containers for a specific project with proper frontend reconnection
   */
  async autoRestartProjectContainers(
    projectName,
    ownerId,
    reason = "file save",
    io = null
  ) {
    console.log(
      `🔄 AUTO-RESTART: Restarting all containers for project: ${projectName}`
    );
    console.log(`📋 Reason: ${reason}`);

    // Find all sessions for this project
    const projectSessions = [];
    for (const [terminalId, session] of this.activeSessions) {
      if (session.projectName === projectName && session.ownerId === ownerId) {
        projectSessions.push({ terminalId, session });
      }
    }

    if (projectSessions.length === 0) {
      console.log(`ℹ️  No active sessions found for project: ${projectName}`);
      return [];
    }

    console.log(`📊 Found ${projectSessions.length} sessions to restart`);
    const restartedSessions = [];

    for (const { terminalId, session } of projectSessions) {
      try {
        const hadWebServer = session.webContainerName || session.webPort;

        // Notify frontend about impending restart
        if (io) {
          io.to(projectName).emit("container-restarting", {
            terminalId,
            projectName,
            message: `Restarting container due to ${reason}...`,
          });
        }

        const newSession = await this.recreateSession(
          terminalId,
          projectName,
          ownerId,
          hadWebServer
        );

        restartedSessions.push({
          terminalId,
          session: newSession,
          webServerRestarted: hadWebServer,
          containerId: newSession.containerId,
          mappedPort: newSession.mappedPort,
          webPort: newSession.webPort,
        });

        // Notify frontend that container is ready
        if (io) {
          io.to(projectName).emit("container-ready", {
            terminalId,
            projectName,
            containerInfo: {
              projectType: newSession.projectType || newSession.imageName,
              url: this.getContainerUrl(newSession),
              containerId: newSession.containerId,
              mappedPort: newSession.mappedPort,
              webPort: newSession.webPort,
            },
            restarted: true,
            timestamp: new Date().toISOString(),
          });

          // Send terminal output to notify user
          io.to(projectName).emit("terminal-output", {
            terminalId,
            output: `🔄 Container restarted successfully! Ready for commands.\n`,
            timestamp: new Date().toISOString(),
          });
        }

        console.log(`✅ Successfully restarted session: ${terminalId}`);
      } catch (error) {
        console.error(
          `❌ Failed to restart session ${terminalId}: ${error.message}`
        );

        // Notify frontend about restart failure
        if (io) {
          io.to(projectName).emit("container-restart-failed", {
            terminalId,
            projectName,
            error: error.message,
          });
        }
      }
    }

    console.log(
      `🎉 AUTO-RESTART completed! Restarted ${restartedSessions.length}/${projectSessions.length} sessions`
    );
    return restartedSessions;
  }

  /**
   * Get session info for frontend reconnection
   */
  getSessionInfo(terminalId) {
    const session = this.activeSessions.get(terminalId);
    if (!session) {
      return null;
    }

    return {
      terminalId,
      projectName: session.projectName,
      containerId: session.containerId,
      mappedPort: session.mappedPort,
      webPort: session.webPort,
      webContainerName: session.webContainerName,
      projectType: session.projectType || session.imageName,
      workingDirectory: session.workingDirectory || "/workspace",
      isActive: true,
    };
  }

  /**
   * Check if session exists and container is running
   */
  async validateSession(terminalId) {
    const session = this.activeSessions.get(terminalId);
    if (!session) {
      return { valid: false, reason: "session_not_found" };
    }

    if (session.containerId) {
      const isRunning = await this.isContainerRunning(session.containerId);
      if (!isRunning) {
        return { valid: false, reason: "container_not_running" };
      }
    }

    return { valid: true, session };
  }
  async cleanup() {
    // No automatic cleanup for containerService sessions
    // Containers stay alive until explicitly closed by user
    console.log(
      "🔄 ContainerService cleanup called - no auto-cleanup performed"
    );

    // Only log active sessions count for monitoring
    console.log(`📊 Active sessions: ${this.activeSessions.size}`);
    console.log(`📊 Active containers: ${this.activeContainers.size}`);
  }
}

module.exports = ContainerService;
