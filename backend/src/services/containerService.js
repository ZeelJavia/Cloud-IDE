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
/**
 * ContainerService - Manages Docker containers for project execution
 * Handles container lifecycle, web serving, and file synchronization
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

  // Additional methods for compatibility with existing code
  async startTerminalSession(terminalId, projectName, ownerId) {
    return this.initializeTerminalSession(terminalId, projectName, ownerId);
  }

  async stopTerminalSession(terminalId) {
    return this.cleanupSession(terminalId);
  }

  async executeCommand(terminalId, command, options = {}) {
    const session = this.activeSessions.get(terminalId);
    if (!session) {
      throw new Error(`Session not found: ${terminalId}`);
    }

    const {
      workingDirectory = "/workspace",
      onStdout,
      onStderr,
      onProcess,
    } = options;
    const dockerArgs = [
      "exec",
      "-i",
      "-w",
      workingDirectory,
      session.containerId,
      "bash",
      "-c",
      command,
    ];

    if (onProcess) {
      // For streaming execution
      const { spawn } = require("child_process");
      const child = spawn("docker", dockerArgs);
      onProcess(child);

      if (onStdout) {
        child.stdout.on("data", (data) => onStdout(data.toString()));
      }
      if (onStderr) {
        child.stderr.on("data", (data) => onStderr(data.toString()));
      }

      return new Promise((resolve) => {
        child.on("close", (code) => {
          resolve({ code, workingDirectory });
        });
      });
    } else {
      // For simple execution
      const result = await spawnWait("docker", dockerArgs);
      return { code: result.code, workingDirectory };
    }
  }

  // Web interface compatibility methods
  getContainerUrl(containerInfo) {
    if (!containerInfo) return null;
    return `http://localhost:${containerInfo.mappedPort || 8080}`;
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
   * Global cleanup method called by server - does nothing for containerService
   * Containers are managed by explicit session lifecycle, not automatic cleanup
   */
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

  /**
   * Sync updated file to container's temporary directory
   * Updates the file in the temp directory so web server serves latest content
   */
  async syncFile(projectName, filePath) {
    console.log(`🔄 Syncing file to containers: ${projectName}/${filePath}`);

    try {
      // Find active sessions for this project
      for (const [terminalId, session] of this.activeSessions) {
        if (session.projectName === projectName && session.tempDir) {
          // Prevent multiple restarts if one is already in progress
          if (session.autoRestartPending) {
            console.log(
              `   ⏳ Auto-restart already pending for ${terminalId}, skipping`
            );
            continue;
          }

          const { ProjectModel, FileModel } = getModels();

          if (!ProjectModel || !FileModel) {
            console.log(`   ⚠️  Database models not available for sync`);
            continue;
          }

          // Find the project in database
          const dbProject = await ProjectModel.findOne({
            name: projectName,
          }).lean();

          if (!dbProject) {
            console.log(`   ⚠️  Project ${projectName} not found in database`);
            continue;
          }

          // Find the updated file
          const dbFile = await FileModel.findOne({
            project: dbProject._id,
            path: filePath,
          }).lean();

          if (dbFile && dbFile.type !== "folder") {
            // Update the file in temp directory
            const targetPath = path.join(session.tempDir, filePath);
            const dir = path.dirname(targetPath);

            // Ensure directory exists
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }

            // Write updated content with verification
            fs.writeFileSync(targetPath, dbFile.content || "", "utf8");

            // Verify write was successful
            const writtenContent = fs.readFileSync(targetPath, "utf8");
            const expectedLength = (dbFile.content || "").length;

            if (writtenContent.length === expectedLength) {
              console.log(
                `   ✅ Synced ${filePath} to ${session.tempDir} (${expectedLength} chars)`
              );

              // AUTOMATICALLY DESTROY AND RECREATE WEB SERVER FOR FRESH CONTENT
              console.log(
                `   🔄 Auto-restarting web server for fresh content...`
              );

              // Set restart pending flag to prevent race conditions
              session.autoRestartPending = true;

              try {
                await this.startWebServer(session.terminalId);
                console.log(
                  `   🎉 SUCCESS! Web server auto-restarted with fresh content!`
                );
                console.log(
                  `   🌍 Updated content now available at: http://localhost:${
                    session.webPort || session.mappedPort
                  }`
                );
              } catch (restartError) {
                console.log(
                  `   ❌ Auto-restart failed: ${restartError.message}`
                );
              } finally {
                // Clear the pending flag after restart attempt
                session.autoRestartPending = false;
              }
            } else {
              console.log(
                `   ⚠️  Sync verification failed! Expected: ${expectedLength}, Got: ${writtenContent.length}`
              );
            }
          }
        }
      }
    } catch (error) {
      console.error(`   ❌ Error syncing file: ${error.message}`);
    }
  }

  /**
   * SIMPLE APPROACH: Start a fresh container with updated project files
   * No complex syncing - just create new container with fresh files from database
   */
  /**
   * Create fresh container with updated project files for immediate content serving
   */
  async startFreshContainerForProject(projectName, userId) {
    console.log(
      `🚀 Starting fresh container for updated project: ${projectName}`
    );

    try {
      const { ProjectModel, FileModel } = getModels();

      if (!ProjectModel || !FileModel) {
        console.log(`   ⚠️  Database not available, skipping fresh container`);
        return;
      }

      // Find project in database
      const dbProject = await ProjectModel.findOne({
        name: projectName,
        owner: userId,
      }).lean();

      if (!dbProject) {
        // Try without userId
        const dbProjectAny = await ProjectModel.findOne({
          name: projectName,
        }).lean();
        if (!dbProjectAny) {
          console.log(`   ⚠️  Project ${projectName} not found in database`);
          return;
        }
      }

      const project =
        dbProject || (await ProjectModel.findOne({ name: projectName }).lean());

      // Generate unique terminal ID for this fresh container
      const freshTerminalId = `fresh-${projectName}-${Date.now()}`;

      console.log(`   🆔 Fresh terminal ID: ${freshTerminalId}`);
      console.log(`   📁 Project: ${project.name} (${project._id})`);

      // Initialize fresh session (this will create temp dir with latest files)
      const session = await this.initializeTerminalSession(
        freshTerminalId,
        project.name,
        String(project.owner)
      );

      console.log(`   ✅ Fresh session created with latest files`);
      console.log(`   📂 Fresh temp dir: ${session.tempDir}`);

      // Start web server on new port
      const webResult = await this.startWebServer(freshTerminalId);

      if (webResult.code === 0) {
        console.log(`   🌐 Fresh container serving updated files!`);
        console.log(`   🔗 New URL: ${webResult.url}`);

        // Store the fresh URL info (could be used by frontend)
        session.freshUrl = webResult.url;
        session.isFreshContainer = true;

        return {
          success: true,
          url: webResult.url,
          port: webResult.webPort,
          terminalId: freshTerminalId,
        };
      } else {
        console.log(`   ❌ Fresh web server failed: ${webResult.error}`);
        // Clean up session if web server failed
        await this.cleanupSession(freshTerminalId);
        return { success: false, error: webResult.error };
      }
    } catch (error) {
      console.error(`   ❌ Fresh container creation failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

module.exports = ContainerService;
