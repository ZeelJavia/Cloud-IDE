const ContainerService = require("../services/containerService");
// Updated path after moving runner.js into src
const { runFile } = require("../runner");
const config = require("../config");
const {
  genId,
  sanitizeArgs,
  sanitizeEnvVars,
} = require("../utils/validationUtils");
const {
  dockerImageExists,
  dockerPullImage,
  ensureWarmContainer,
  reusePool,
} = require("../utils/dockerUtils");
const { spawn } = require("child_process");
const { setCurrentProject } = require("../utils/webServerState");
const fs = require("fs");
const path = require("path");

// Active runs per terminal
const activeRuns = new Map(); // terminalId -> { mode: 'docker'|'local', child, containerName? }

// Run history (recent N)
const runHistory = [];
function addRunHistory(entry) {
  try {
    runHistory.push(entry);
    while (runHistory.length > config.MAX_RUN_HISTORY) runHistory.shift();
  } catch {}
}

// Initialize containerized terminal service
const containerTerminal = new ContainerService();

const socketHandlers = (io) => {
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

        // Announce fixed web serving port instead of random mapped dev port
        socket.emit("terminal-output", {
          terminalId,
          output: `🌐 Web projects are served at: http://localhost:${
            config.WEB_PORT || 8088
          } (start with: serve)\n`,
        });

        socket.emit("terminal-output", {
          terminalId,
          output: `📁 Working directory: /workspace\n\n`,
        });

        socket.emit("container-ready", {
          terminalId,
          projectName,
          containerInfo: {
            projectType: containerInfo.projectType,
            url: containerTerminal.getContainerUrl(containerInfo),
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
      const { terminalId, port = 8088, workingDirectory } = data || {};

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

        const result = await containerTerminal.startWebServer(
          terminalId,
          port,
          {
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
          }
        );

        // Don't delete activeRuns for web servers as they should keep running
        // activeRuns.delete(terminalId);

        // Set current project for root-level web serving and announce container-mapped URL
        try {
          const sess = containerTerminal.getSession(terminalId);
          if (sess?.projectName) setCurrentProject(sess.projectName);
          if (result.code === 0) {
            const info = containerTerminal.getWebInfo(terminalId);
            const url = info?.webPort
              ? `http://localhost:${info.webPort}`
              : null;
            if (url) socket.emit("web-project-ready", { terminalId, url });
            // Also print to the terminal explicitly at fixed port
            socket.emit("terminal-output", {
              terminalId,
              output: `🌐 Web server available at: http://localhost:${
                config.WEB_PORT || 8088
              }\n`,
            });
          } else {
            // Do not emit fallback URL; enforce fixed port policy
            socket.emit("terminal-output", {
              terminalId,
              output:
                "Web server failed to start on fixed port. Ensure port is free (" +
                (config.WEB_PORT || 8088) +
                ") and try again.\n",
              error: true,
            });
          }
        } catch {}

        socket.emit("command-completed", {
          terminalId,
          exitCode: result.code,
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
        PROJECTS_DIR: config.getProjectsDir(),
      });

      let cwd = config.getProjectsDir();
      try {
        if (workingDirectory && typeof workingDirectory === "string") {
          const candidate = path.isAbsolute(workingDirectory)
            ? workingDirectory
            : path.join(config.getProjectsDir(), workingDirectory);
          const resolved = path.resolve(candidate);

          console.log(`[DEBUG] Directory resolution:`, {
            candidate,
            resolved,
            projectsDir: path.resolve(config.getProjectsDir()),
            exists: fs.existsSync(resolved),
            startsWithProjects: resolved.startsWith(
              path.resolve(config.getProjectsDir())
            ),
          });

          if (
            resolved.startsWith(path.resolve(config.getProjectsDir())) &&
            fs.existsSync(resolved)
          ) {
            cwd = resolved;
            console.log(`[DEBUG] Using cwd: ${cwd}`);
          } else {
            console.log(
              `[DEBUG] Using default cwd: ${cwd} (validation failed)`
            );
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
            const { spawnSync } = require("child_process");
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
              const projectsResolved = path.resolve(config.getProjectsDir());
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

    // Containerized file execution (compat; currently uses local runner)
    socket.on("run-container-file", async (data = {}) => {
      try {
        const {
          terminalId = "terminal-1",
          projectName,
          filePath,
          args = [],
          stdinText,
          envVars = {},
          workingDirectory,
        } = data;

        if (!projectName || !filePath) {
          socket.emit("terminal-output", {
            terminalId,
            output:
              "run-container-file: projectName and filePath are required\n",
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

        // Defer to common runner
        await handleRunFile({
          socket,
          terminalId,
          projectName,
          filePath,
          args,
          stdinText,
          envVars,
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

    // Program run with streaming over sockets (local/docker fallback)
    socket.on("run-file", async (data = {}) => {
      try {
        const {
          terminalId = "terminal-1",
          projectName,
          filePath,
          args = [],
          stdinText,
          timeoutSec = 30,
          envVars = {},
        } = data;

        if (!projectName || !filePath) {
          socket.emit("terminal-output", {
            terminalId,
            output: "run-file: projectName and filePath are required\n",
            error: true,
          });
          socket.emit("command-completed", { terminalId, exitCode: -1 });
          return;
        }

        socket.emit("terminal-output", {
          terminalId,
          output: `\n=== Running file: ${filePath} ===\n`,
        });

        await handleRunFile({
          socket,
          terminalId,
          projectName,
          filePath,
          args,
          stdinText,
          envVars,
          timeoutSec,
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
    socket.on("run-stop", async (payload = {}) => {
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
        try {
          rec.child?.kill?.("SIGKILL");
        } catch {}
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
          const userTerminals =
            containerTerminal.getUserTerminalSessions(userId);
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
            await containerTerminal.stopContainer(container.containerId);
          }

          console.log(`Cleanup completed for user ${userId}`);
        }
      } catch (error) {
        console.error("Error during socket disconnect cleanup:", error);
      }
    });

    // ... (include other socket handlers like run-file, run-container-file, etc.)
  });

  return {
    activeRuns,
    runHistory,
    addRunHistory,
    containerTerminal,
  };
};

// Helper: common run-file logic using local runner; supports DB-backed projects via temp materialization
async function handleRunFile({
  socket,
  terminalId,
  projectName,
  filePath,
  args = [],
  stdinText,
  envVars = {},
  timeoutSec = 30,
}) {
  const path = require("path");
  const fs = require("fs");
  const { getModels } = require("../config/database");

  // sanitize path
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

  // Prepare project directory (filesystem or ephemeral from DB)
  let projectDir = path.join(config.getProjectsDir(), projectName);
  let ephemeralDir = null;

  try {
    const { ProjectModel, FileModel } = getModels();
    if (config.USE_DB_PROJECTS_BOOL && ProjectModel && FileModel) {
      const ownerId = socket.user?.id;
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
      const os = require("os");
      const tmpBase = fs.mkdtempSync(
        path.join(os.tmpdir(), `ide-${projectName}-`)
      );
      ephemeralDir = tmpBase;
      projectDir = ephemeralDir;

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
    } else {
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
  } catch (e) {
    socket.emit("terminal-output", {
      terminalId,
      output: `Failed to prepare run directory: ${e.message}\n`,
      error: true,
    });
    socket.emit("command-completed", { terminalId, exitCode: -1 });
    return;
  }

  // Execute using local runner
  const cleanArgs = sanitizeArgs(args);
  const runId = genId();
  const startTime = Date.now();
  try {
    const result = await runFile(
      projectDir,
      sanitizedFilePath,
      Array.isArray(cleanArgs) ? cleanArgs : [],
      timeoutSec || 20,
      stdinText != null ? String(stdinText) : undefined
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
  } catch (e) {
    socket.emit("terminal-output", {
      terminalId,
      output: `Execution failed: ${e.message}\n`,
      error: true,
    });
    socket.emit("command-completed", { terminalId, exitCode: -1 });
  } finally {
    try {
      if (ephemeralDir)
        fs.rmSync(ephemeralDir, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = socketHandlers;
