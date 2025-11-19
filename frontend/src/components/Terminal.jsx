import React, { useState, useRef, useEffect } from "react";
import {
  FiTerminal,
  FiX,
  FiPlus,
  FiMoreHorizontal,
  FiTrash2,
  FiRefreshCw,
  FiSquare,
  FiPlay,
  FiArrowUp,
  FiArrowDown,
} from "react-icons/fi";
import "./Terminal.css";

const Terminal = ({ socket, project, user }) => {
  const [terminals, setTerminals] = useState([]);
  const [activeTerminal, setActiveTerminal] = useState(null);
  const [output, setOutput] = useState({});
  const [input, setInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [terminalStates, setTerminalStates] = useState({});
  const [projectFiles, setProjectFiles] = useState([]);

  const inputRef = useRef(null);
  const outputRef = useRef(null);
  const nextTerminalId = useRef(1);

  // Create first terminal on mount
  useEffect(() => {
    if (terminals.length === 0 && project) {
      createNewTerminal();
    }
  }, [project]);

  // Load project files for suggestions
  useEffect(() => {
    const loadProjectFiles = async () => {
      if (!project) return;

      try {
        const token = localStorage.getItem("token");
        const projectName = project?.name || project?.id;
        const response = await fetch(
          `${
            process.env.REACT_APP_API_URL || "http://localhost:3001"
          }/api/projects/${projectName}/files`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (response.ok) {
          const files = await response.json();
          const flatFiles = flattenFiles(files);
          setProjectFiles(flatFiles);
        }
      } catch (error) {
        console.error("Error loading project files:", error);
      }
    };

    loadProjectFiles();
  }, [project]);

  // Handle project switching - close old terminals and create new one
  useEffect(() => {
    const currentProjectName = project?.name || project?.id;
    
    if (currentProjectName && terminals.length > 0) {
      // Check if we've switched to a different project
      const activeSession = terminals.find(t => t.id === activeTerminal);
      const sessionProjectName = activeSession?.projectName;
      
      if (sessionProjectName && sessionProjectName !== currentProjectName) {
        console.log(`🔄 Project switched from ${sessionProjectName} to ${currentProjectName}`);
        
        // Close all existing terminals for the old project
        terminals.forEach(terminal => {
          if (socket && terminal.id) {
            console.log(`🚪 Closing old terminal for project switch: ${terminal.id}`);
            socket.emit("close-project", { terminalId: terminal.id });
          }
        });
        
        // Clear terminals state
        setTerminals([]);
        setActiveTerminal(null);
        setOutput({});
        setTerminalStates({});
        
        // Create new terminal for new project after a short delay
        setTimeout(() => {
          createNewTerminal();
        }, 500);
      }
    }
  }, [project?.name, project?.id]);

  const flattenFiles = (files) => {
    let result = [];
    files.forEach((file) => {
      result.push(file);
      if (file.children) {
        result = result.concat(flattenFiles(file.children));
      }
    });
    return result;
  };

  // Socket event listeners
  useEffect(() => {
    if (socket) {
      socket.on("terminal-output", (data) => {
        const { terminalId, output: newOutput, error } = data;
        setOutput((prev) => ({
          ...prev,
          [terminalId]: [
            ...(prev[terminalId] || []),
            {
              type: error ? "error" : "output",
              content: newOutput,
              timestamp: new Date().toISOString(),
            },
          ],
        }));
      });

      socket.on("container-ready", (data) => {
        const { terminalId, projectName, containerInfo } = data;
        setOutput((prev) => ({
          ...prev,
          [terminalId]: [
            ...(prev[terminalId] || []),
            {
              type: "system",
              content: `🐳 Container ready for project: ${projectName} (${containerInfo.projectType})`,
              timestamp: new Date().toISOString(),
            },
          ],
        }));

        if (containerInfo.url) {
          const port = containerInfo.url.split(':')[2] || '8088';
          setOutput((prev) => ({
            ...prev,
            [terminalId]: [
              ...(prev[terminalId] || []),
              {
                type: "system",
                content: `🌐 Web project available at: ${port}`,
                timestamp: new Date().toISOString(),
              },
            ],
          }));
        }
      });

      socket.on("web-project-ready", (data) => {
        const { terminalId, url, filePath } = data;
        setOutput((prev) => ({
          ...prev,
          [terminalId]: [
            ...(prev[terminalId] || []),
            {
              type: "system",
              content: `🌐 Web project running: ${url}`,
              timestamp: new Date().toISOString(),
            },
          ],
        }));
      });

      // Listen for file updates to restart web server if needed
      socket.on("file-updated", (data) => {
        const { projectName, filePath, content } = data;
        const currentProjectName = project?.name || project?.id;
        
        // Only handle updates for current project
        if (projectName !== currentProjectName) return;
        
        // Check if it's a web file that should trigger web server restart
        const webFileExtensions = ['.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.json', '.xml'];
        const isWebFile = webFileExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
        
        if (isWebFile && activeTerminal) {
          console.log(`📝 Web file updated: ${filePath}`);
          
          // Add feedback to terminal
          setOutput((prev) => ({
            ...prev,
            [activeTerminal.id]: [
              ...(prev[activeTerminal.id] || []),
              {
                type: "system",
                content: `📝 File updated: ${filePath}`,
                timestamp: new Date().toISOString(),
              },
              {
                type: "system", 
                content: `🔄 Restarting web server with updated files...`,
                timestamp: new Date().toISOString(),
              },
            ],
          }));
          
          // Restart web server after a longer delay to ensure file sync completes
          setTimeout(() => {
            if (socket && activeTerminal) {
              socket.emit("start-web-server", {
                terminalId: activeTerminal.id, // Send the ID, not the full object
                workingDirectory: "/workspace"
              });
            }
          }, 2000); // Increased delay to 2 seconds
        }
      });

      socket.on("command-completed", (data) => {
        const { terminalId, exitCode, workingDirectory } = data;

        // Update terminal state for the specific terminalId when workingDirectory provided
        if (workingDirectory !== undefined) {
          setTerminalStates((prev) => {
            const prevState = prev[terminalId] || {};

            if (prevState?.containerized) {
              // Container-based: store absolute container path
              const containerPath = workingDirectory || "/workspace";
              return {
                ...prev,
                [terminalId]: {
                  ...prevState,
                  currentDirectory: containerPath,
                  absolutePath: containerPath,
                  containerized: true,
                },
              };
            }

            // Legacy filesystem handling (map to Windows path for display)
            const projectBasePath = `D:\\DevDock\\code-manager`;
            let absolutePath;

            if (workingDirectory) {
              const isAbsolute =
                workingDirectory.includes(":") ||
                workingDirectory.startsWith("\\");
              if (isAbsolute) {
                absolutePath = workingDirectory;
              } else {
                const parts = [projectBasePath, workingDirectory]
                  .join("\\")
                  .split("\\")
                  .filter((p) => p);
                absolutePath = parts.join("\\");
                if (!absolutePath.includes(":"))
                  absolutePath = "D:\\" + absolutePath;
              }
            } else {
              absolutePath = `${projectBasePath}\\${
                project?.name || project?.id || ""
              }`;
            }

            return {
              ...prev,
              [terminalId]: {
                ...prevState,
                currentDirectory: workingDirectory || project?.name || "",
                absolutePath: absolutePath.replace(/\//g, "\\"),
                containerized: false,
              },
            };
          });
        }

        setOutput((prev) => ({
          ...prev,
          [terminalId]: [
            ...(prev[terminalId] || []),
            {
              type: "system",
              content: `Command completed with exit code: ${exitCode}`,
              timestamp: new Date().toISOString(),
            },
          ],
        }));
        setIsExecuting(false);
      });

      // Handle container auto-recovery
      socket.on("container-recovered", (data) => {
        const { terminalId, message, timestamp } = data;
        setOutput((prev) => ({
          ...prev,
          [terminalId]: [
            ...(prev[terminalId] || []),
            {
              type: "recovery",
              content: `🔄 Container Auto-Recovery: ${message}`,
              timestamp: timestamp || new Date().toISOString(),
            },
          ],
        }));

        // Update terminal state to show recovery
        setTerminalStates((prev) => {
          const prevState = prev[terminalId] || {};
          return {
            ...prev,
            [terminalId]: {
              ...prevState,
              lastRecovered: new Date().toISOString(),
              status: 'recovered',
            },
          };
        });

        // Clear the recovery indicator after 10 seconds
        setTimeout(() => {
          setTerminalStates((prev) => {
            const prevState = prev[terminalId] || {};
            if (prevState.status === 'recovered') {
              return {
                ...prev,
                [terminalId]: {
                  ...prevState,
                  status: 'normal',
                },
              };
            }
            return prev;
          });
        }, 10000);
      });

      // Handle terminal errors (including session invalid)
      socket.on("terminal-error", (data) => {
        const { terminalId, error, timestamp } = data;
        setOutput((prev) => ({
          ...prev,
          [terminalId]: [
            ...(prev[terminalId] || []),
            {
              type: "error",
              content: `❌ Terminal Error: ${error}`,
              timestamp: timestamp || new Date().toISOString(),
            },
          ],
        }));
      });

      // Handle session invalidation (when auto-recovery is not possible)
      socket.on("session-invalid", (data) => {
        const { terminalId, reason, message } = data;
        setOutput((prev) => ({
          ...prev,
          [terminalId]: [
            ...(prev[terminalId] || []),
            {
              type: "warning",
              content: `⚠️ Session Invalid: ${message}`,
              timestamp: new Date().toISOString(),
            },
            {
              type: "system",
              content: `🔧 Please restart this terminal to continue.`,
              timestamp: new Date().toISOString(),
            },
          ],
        }));

        // Mark terminal as requiring restart
        setTerminalStates((prev) => {
          const prevState = prev[terminalId] || {};
          return {
            ...prev,
            [terminalId]: {
              ...prevState,
              status: 'needs-restart',
              invalidReason: reason,
            },
          };
        });
      });

      return () => {
        socket.off("terminal-output");
        socket.off("command-completed");
        socket.off("container-ready");
        socket.off("web-project-ready");
        socket.off("file-updated");
        socket.off("container-recovered");
        socket.off("terminal-error");
        socket.off("session-invalid");
      };
    }
  }, [socket, activeTerminal, project]);

  // Listen for program run results from CodeEditor and append to terminal
  useEffect(() => {
    const handleProgramRun = (event) => {
      const { terminalId, result } = event.detail;
      if (activeTerminal?.id === terminalId || terminalId === "default") {
        const targetId =
          terminalId === "default" ? activeTerminal?.id : terminalId;
        if (targetId) {
          setOutput((prev) => ({
            ...prev,
            [targetId]: [
              ...(prev[targetId] || []),
              {
                type: "program-result",
                content: result,
                timestamp: new Date().toISOString(),
              },
            ],
          }));
        }
      }
    };

    window.addEventListener("programRun", handleProgramRun);
    return () => window.removeEventListener("programRun", handleProgramRun);
  }, [activeTerminal]);

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, activeTerminal]);

  // Focus input when terminal becomes active
  useEffect(() => {
    if (activeTerminal && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeTerminal]);

  // Listen for ide-run-file events from CodeEditor
  useEffect(() => {
    const handleIdeRunFile = (event) => {
      const {
        projectName,
        filePath,
        args,
        stdinText,
        envVars,
        useDocker,
        timeoutSec,
        limits,
      } = event.detail;

      if (socket && activeTerminal) {
        // Add execution info to terminal output
        setOutput((prev) => ({
          ...prev,
          [activeTerminal.id]: [
            ...(prev[activeTerminal.id] || []),
            {
              type: "system",
              content: `🚀 Running ${filePath}${
                args.length ? " (args: " + args.join(" ") + ")" : ""
              }`,
              timestamp: new Date().toISOString(),
            },
          ],
        }));

        // Emit containerized run-file event to backend
        if (activeTerminal.containerized) {
          const token = localStorage.getItem("token");
          const user = JSON.parse(localStorage.getItem("user") || "{}");
          const currentState = terminalStates[activeTerminal.id] || {};

          socket.emit("run-container-file", {
            terminalId: activeTerminal.id,
            projectName,
            filePath,
            args,
            stdinText,
            envVars,
            userId: user.id,
            workingDirectory: currentState?.currentDirectory || "/workspace",
          });
        } else {
          // Fallback to legacy run-file
          socket.emit("run-file", {
            terminalId: activeTerminal.id,
            projectName,
            filePath,
            args,
            stdinText,
            useDocker,
            timeoutSec,
            envVars,
            limits,
          });
        }
      }
    };

    window.addEventListener("ide-run-file", handleIdeRunFile);
    return () => window.removeEventListener("ide-run-file", handleIdeRunFile);
  }, [socket, activeTerminal]);

  // Cleanup effect - notify backend when component unmounts
  useEffect(() => {
    return () => {
      // Component is unmounting - notify backend to cleanup containers
      if (socket && user && project) {
        console.log("Terminal component unmounting, cleaning up containers...");

        // Notify backend about project close
        socket.emit("close-project", {
          projectName: project.name || project.id,
          userId: user.id,
        });

        // Also notify about any active terminals
        terminals.forEach((terminal) => {
          socket.emit("close-terminal", {
            terminalId: terminal.id,
            userId: user.id,
          });
        });
      }
    };
  }, []); // Empty dependency array - only run on unmount

  const createNewTerminal = () => {
    const projectName = project?.name || project?.id;
    const newTerminal = {
      id: nextTerminalId.current++,
      name: `Terminal ${nextTerminalId.current - 1}`,
      workingDirectory: projectName || "",
      projectName: projectName, // Store project name for comparison
      createdAt: new Date().toISOString(),
      containerized: true,
    };

    setTerminals((prev) => [...prev, newTerminal]);
    setActiveTerminal(newTerminal);

    // Initialize terminal state with proper directory
    setTerminalStates((prev) => ({
      ...prev,
      [newTerminal.id]: {
        currentDirectory: "/workspace",
        absolutePath: "/workspace",
        projectRoot: project?.name || "",
        containerized: true,
      },
    }));

    // Initialize output for new terminal with welcome message
    setOutput((prev) => ({
      ...prev,
      [newTerminal.id]: [
        {
          type: "system",
          content: `🚀 Terminal ${newTerminal.id} initialized`,
          timestamp: new Date().toISOString(),
        },
        {
          type: "system",
          content: `� Initializing containerized environment...`,
          timestamp: new Date().toISOString(),
        },
      ],
    }));

    // Initialize container for this terminal
    if (socket && project) {
      const token = localStorage.getItem("token");
      const user = JSON.parse(localStorage.getItem("user") || "{}");

      socket.emit("init-container-terminal", {
        terminalId: newTerminal.id,
        projectName: project.name || project.id,
        userId: user.id,
      });
    }
  };

  const closeTerminal = (terminalId) => {
    // Notify backend about terminal closure for container cleanup
    if (socket && user) {
      socket.emit("close-terminal", {
        terminalId,
        userId: user.id,
      });
    }

    setTerminals((prev) => prev.filter((t) => t.id !== terminalId));
    setOutput((prev) => {
      const newOutput = { ...prev };
      delete newOutput[terminalId];
      return newOutput;
    });

    if (activeTerminal?.id === terminalId) {
      const remainingTerminals = terminals.filter((t) => t.id !== terminalId);
      setActiveTerminal(remainingTerminals[0] || null);
    }
  };

  const clearTerminal = () => {
    if (!activeTerminal) return;
    setOutput((prev) => ({
      ...prev,
      [activeTerminal.id]: [],
    }));
  };

  // Get current terminal state
  const getCurrentTerminalState = () => {
    if (!activeTerminal) return null;
    return (
      terminalStates[activeTerminal.id] || {
        currentDirectory: project?.name || "",
        absolutePath: `D:\\DevDock\\code-manager\\${project?.name || ""}`,
        projectRoot: project?.name || "",
      }
    );
  };

  // Smart command parser for directory navigation and file execution
  const parseCommand = (command) => {
    const parts = command.trim().split(/\s+/);
    if (parts.length === 0) return null;

    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Handle directory navigation
    if (cmd === "cd") {
      return {
        type: "directory-change",
        path: args[0] || "~",
        command: command,
      };
    }

    // Handle directory listing
    if (cmd === "ls" || cmd === "dir") {
      return {
        type: "directory-list",
        path: args[0] || ".",
        command: command,
      };
    }

    // Handle pwd/current directory
    if (cmd === "pwd") {
      return {
        type: "print-directory",
        command: command,
      };
    }

    // Handle web server commands
    if (cmd === "serve" || cmd === "webserver" || cmd === "http-server") {
      const port = args[0] || "8080";
      return {
        type: "start-web-server",
        port: port,
        command: command,
      };
    }

    // Handle container info commands
    if (cmd === "containers" || cmd === "docker-ps") {
      return {
        type: "show-containers",
        command: command,
      };
    }

    // Check if it's a direct file execution command
    const originalCmd = parts[0]; // Keep original case for file names
    if (
      originalCmd.endsWith(".py") ||
      originalCmd.endsWith(".js") ||
      originalCmd.endsWith(".java") ||
      originalCmd.endsWith(".c") ||
      originalCmd.endsWith(".cpp") ||
      originalCmd.endsWith(".go") ||
      originalCmd.endsWith(".html")
    ) {
      return {
        type: "file-execution",
        filePath: originalCmd,
        args: args,
        language: getLanguageFromFile(originalCmd),
      };
    }

    // Check for language-specific run commands
    if ((cmd === "python" || cmd === "python3") && args.length > 0) {
      return {
        type: "file-execution",
        filePath: args[0],
        args: args.slice(1),
        language: "python",
      };
    }

    if (cmd === "node" && args.length > 0) {
      return {
        type: "file-execution",
        filePath: args[0],
        args: args.slice(1),
        language: "javascript",
      };
    }

    if (cmd === "java" && args.length > 0) {
      return {
        type: "file-execution",
        filePath: args[0] + ".java",
        args: args.slice(1),
        language: "java",
      };
    }

    // Regular shell command
    return {
      type: "shell-command",
      command: command,
    };
  };

  const getLanguageFromFile = (filename) => {
    const ext = filename.split(".").pop()?.toLowerCase();
    const langMap = {
      py: "python",
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      java: "java",
      c: "c",
      cpp: "cpp",
      go: "go",
      rs: "rust",
      rb: "ruby",
      php: "php",
      html: "html",
      htm: "html",
    };
    return langMap[ext] || "unknown";
  };

  const executeCommand = async () => {
    if (!input.trim() || !activeTerminal || isExecuting) return;

    const command = input.trim();
    setInput("");
    setIsExecuting(true);
    setShowSuggestions(false);

    // Add command to history
    setCommandHistory((prev) => [...prev, command]);
    setHistoryIndex(-1);

    // Add command to output
    setOutput((prev) => ({
      ...prev,
      [activeTerminal.id]: [
        ...(prev[activeTerminal.id] || []),
        {
          type: "command",
          content: command,
          timestamp: new Date().toISOString(),
        },
      ],
    }));

    try {
      const parsed = parseCommand(command);

      // Handle directory navigation commands using containerized execution
      if (parsed) {
        if (
          parsed.type === "directory-change" ||
          parsed.type === "directory-list" ||
          parsed.type === "print-directory"
        ) {
          // Use containerized terminal execution
          if (socket && activeTerminal.containerized) {
            const currentState = terminalStates[activeTerminal.id] || {};

            socket.emit("execute-container-command", {
              terminalId: activeTerminal.id,
              command,
              workingDirectory: currentState?.currentDirectory || "/workspace",
            });
          } else {
            // Fallback to legacy execution
            if (socket) {
              const currentState = getCurrentTerminalState();
              let workingDir = activeTerminal.workingDirectory;

              // Convert absolute path to relative path for backend
              if (currentState?.absolutePath && !currentState.containerized) {
                const projectBasePath = `D:\\DevDock\\code-manager\\${
                  project?.name || project?.id
                }`;
                if (currentState.absolutePath.startsWith(projectBasePath)) {
                  workingDir =
                    currentState.absolutePath
                      .replace(projectBasePath, "")
                      .replace(/^\\/, "") ||
                    project?.name ||
                    project?.id;
                } else {
                  workingDir = project?.name || project?.id;
                }
              }

              socket.emit("execute-command", {
                terminalId: activeTerminal.id,
                command,
                workingDirectory: workingDir,
                projectName: project?.name || project?.id,
              });
            } else {
              setIsExecuting(false);
            }
          }
          return;
        }

        if (parsed.type === "start-web-server") {
          // Handle web server start command
          if (socket && activeTerminal.containerized) {
            const currentState = terminalStates[activeTerminal.id] || {};

            // Add system message about starting web server
            setOutput((prev) => ({
              ...prev,
              [activeTerminal.id]: [
                ...(prev[activeTerminal.id] || []),
                {
                  type: "system",
                  content: `🌐 Starting web server on port ${parsed.port}...`,
                  timestamp: new Date().toISOString(),
                },
              ],
            }));

            // Emit web server start command
            socket.emit("start-web-server", {
              terminalId: activeTerminal.id,
              port: parsed.port,
              workingDirectory: currentState?.currentDirectory || "/workspace",
            });
          } else {
            setOutput((prev) => ({
              ...prev,
              [activeTerminal.id]: [
                ...(prev[activeTerminal.id] || []),
                {
                  type: "error",
                  content: "Web server is only available in containerized mode",
                  timestamp: new Date().toISOString(),
                },
              ],
            }));
            setIsExecuting(false);
          }
          return;
        }

        if (parsed.type === "show-containers") {
          // Handle show containers command
          if (socket && activeTerminal.containerized) {
            socket.emit("execute-container-command", {
              terminalId: activeTerminal.id,
              command: "docker ps --filter name=devdock-project",
              workingDirectory: "/workspace",
            });
          } else {
            setOutput((prev) => ({
              ...prev,
              [activeTerminal.id]: [
                ...(prev[activeTerminal.id] || []),
                {
                  type: "error",
                  content:
                    "Container info is only available in containerized mode",
                  timestamp: new Date().toISOString(),
                },
              ],
            }));
            setIsExecuting(false);
          }
          return;
        }
      }

      if (parsed && parsed.type === "file-execution") {
        // Handle direct file execution via containerized run-file event
        const projectName = project?.name || project?.id;
        if (projectName && socket) {
          // Add execution info
          setOutput((prev) => ({
            ...prev,
            [activeTerminal.id]: [
              ...(prev[activeTerminal.id] || []),
              {
                type: "system",
                content: `🚀 Running ${parsed.filePath} with ${
                  parsed.language
                }${
                  parsed.args.length
                    ? " (args: " + parsed.args.join(" ") + ")"
                    : ""
                }`,
                timestamp: new Date().toISOString(),
              },
            ],
          }));

          if (activeTerminal.containerized) {
            const token = localStorage.getItem("token");
            const user = JSON.parse(localStorage.getItem("user") || "{}");
            const currentState = terminalStates[activeTerminal.id] || {};

            socket.emit("run-container-file", {
              terminalId: activeTerminal.id,
              projectName,
              filePath: parsed.filePath,
              args: parsed.args,
              userId: user.id,
              envVars: {},
              workingDirectory: currentState?.currentDirectory || "/workspace",
            });
          } else {
            // Legacy approach
            socket.emit("run-file", {
              terminalId: activeTerminal.id,
              projectName,
              filePath: parsed.filePath,
              args: parsed.args,
              useDocker: true,
              timeoutSec: 30,
              envVars: {},
              limits: {
                cpus: "1.0",
                memory: "512m",
                pids: 256,
              },
            });
          }
          return;
        }
      }

      // Handle as regular shell command
      if (socket) {
        if (activeTerminal.containerized) {
          // Use containerized execution - read state by terminal id to avoid stale activeTerminal issues
          const currentState = terminalStates[activeTerminal.id] || {};

          socket.emit("execute-container-command", {
            terminalId: activeTerminal.id,
            command,
            workingDirectory: currentState?.currentDirectory || "/workspace",
          });
        } else {
          // Legacy execution
          const currentState = getCurrentTerminalState();
          let workingDir = activeTerminal.workingDirectory;

          // Convert absolute path to relative path for backend
          if (currentState?.absolutePath) {
            const projectBasePath = `D:\\DevDock\\code-manager\\${
              project?.name || project?.id
            }`;
            if (currentState.absolutePath.startsWith(projectBasePath)) {
              // Get relative path from project root
              const relativePart = currentState.absolutePath
                .replace(projectBasePath, "")
                .replace(/^\\/, "");

              // If we're at project root, use just project name
              // If we're in a subdirectory, use project name + subdirectory path
              workingDir = relativePart
                ? `${project?.name || project?.id}\\${relativePart}`.replace(
                    /\\\\/g,
                    "\\"
                  )
                : project?.name || project?.id;
            } else {
              workingDir = project?.name || project?.id;
            }
          }

          socket.emit("execute-command", {
            terminalId: activeTerminal.id,
            command,
            workingDirectory: workingDir,
            projectName: project?.name || project?.id,
          });
        }
      } else {
        // Fallback to HTTP request
        const currentState = getCurrentTerminalState();
        let workingDir = activeTerminal.workingDirectory;

        // Convert absolute path to relative path for backend
        if (currentState?.absolutePath) {
          const projectBasePath = `D:\\DevDock\\code-manager\\${
            project?.name || project?.id
          }`;
          if (currentState.absolutePath.startsWith(projectBasePath)) {
            workingDir =
              currentState.absolutePath
                .replace(projectBasePath, "")
                .replace(/^\\/, "") ||
              project?.name ||
              project?.id;
          } else {
            workingDir = project?.name || project?.id;
          }
        }

        try {
          const token = localStorage.getItem("token");
          const response = await fetch(
            `${
              process.env.REACT_APP_API_URL || "http://localhost:3001"
            }/api/execute-command`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                command,
                workingDirectory: workingDir,
              }),
            }
          );

          if (response.ok) {
            const result = await response.json();
            setOutput((prev) => ({
              ...prev,
              [activeTerminal.id]: [
                ...(prev[activeTerminal.id] || []),
                {
                  type: "output",
                  content: result.output || "Command executed",
                  timestamp: new Date().toISOString(),
                },
              ],
            }));
          } else {
            throw new Error("Command execution failed");
          }
        } catch (error) {
          setOutput((prev) => ({
            ...prev,
            [activeTerminal.id]: [
              ...(prev[activeTerminal.id] || []),
              {
                type: "error",
                content: `Error: ${error.message}`,
                timestamp: new Date().toISOString(),
              },
            ],
          }));
        }
        setIsExecuting(false);
      }
    } catch (error) {
      setOutput((prev) => ({
        ...prev,
        [activeTerminal.id]: [
          ...(prev[activeTerminal.id] || []),
          {
            type: "error",
            content: `Error: ${error.message}`,
            timestamp: new Date().toISOString(),
          },
        ],
      }));
      setIsExecuting(false);
    }
  };

  const generateSuggestions = (inputText) => {
    const suggestions = [];
    const lowerInput = inputText.toLowerCase();

    // Common commands
    const commonCommands = [
      "ls",
      "dir",
      "cd",
      "pwd",
      "mkdir",
      "rmdir",
      "rm",
      "cp",
      "mv",
      "cat",
      "echo",
      "grep",
      "find",
      "python",
      "python3",
      "node",
      "npm",
      "yarn",
      "java",
      "javac",
      "gcc",
      "g++",
      "go",
      "rustc",
      "git",
      "git status",
      "git add",
      "git commit",
      "git push",
      "git pull",
      "git clone",
      "serve",
      "webserver",
      "http-server",
      "containers",
      "docker-ps",
    ];

    // Add matching common commands
    commonCommands.forEach((cmd) => {
      if (cmd.startsWith(lowerInput)) {
        suggestions.push({
          type: "command",
          text: cmd,
          description: getCommandDescription(cmd),
        });
      }
    });

    // Add file execution suggestions
    projectFiles.forEach((file) => {
      if (file.name.toLowerCase().includes(lowerInput)) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (["py", "js", "java", "c", "cpp", "go", "html"].includes(ext)) {
          suggestions.push({
            type: "execution",
            text: file.name,
            description: `Run ${getLanguageFromFile(file.name)} file`,
          });
        }
      }
    });

    return suggestions.slice(0, 8); // Limit to 8 suggestions
  };

  const getCommandDescription = (cmd) => {
    const descriptions = {
      ls: "List directory contents",
      dir: "List directory contents (Windows)",
      cd: "Change directory",
      pwd: "Print working directory",
      python: "Run Python interpreter",
      node: "Run Node.js",
      git: "Git version control",
      npm: "Node package manager",
      mkdir: "Create directory",
      cat: "Display file contents",
      serve: "Start web server for current directory",
      webserver: "Start web server for current directory",
      "http-server": "Start HTTP server for current directory",
      containers: "Show running containers",
      "docker-ps": "Show Docker container status",
    };
    return descriptions[cmd] || "Shell command";
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInput(value);

    // Generate suggestions
    if (value.trim()) {
      const newSuggestions = generateSuggestions(value.trim());
      setSuggestions(newSuggestions);
      setShowSuggestions(newSuggestions.length > 0);
      setSelectedSuggestion(0);
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      if (
        showSuggestions &&
        selectedSuggestion >= 0 &&
        suggestions[selectedSuggestion]
      ) {
        // Apply selected suggestion
        setInput(suggestions[selectedSuggestion].text);
        setShowSuggestions(false);
      } else {
        executeCommand();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (showSuggestions) {
        setSelectedSuggestion((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
      } else {
        // Command history
        if (historyIndex < commandHistory.length - 1) {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          setInput(commandHistory[commandHistory.length - 1 - newIndex]);
        }
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (showSuggestions) {
        setSelectedSuggestion((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
      } else {
        // Command history
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          setInput(commandHistory[commandHistory.length - 1 - newIndex]);
        } else if (historyIndex === 0) {
          setHistoryIndex(-1);
          setInput("");
        }
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (showSuggestions && suggestions[selectedSuggestion]) {
        setInput(suggestions[selectedSuggestion].text);
        setShowSuggestions(false);
      } else {
        // Generate suggestions if none are showing
        if (input.trim()) {
          const newSuggestions = generateSuggestions(input.trim());
          setSuggestions(newSuggestions);
          setShowSuggestions(newSuggestions.length > 0);
          setSelectedSuggestion(0);
        }
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  };

  const getPrompt = () => {
    const terminalState = getCurrentTerminalState();
    if (terminalState) {
      if (terminalState.containerized) {
        // Container-based prompt
        const currentDir = terminalState.currentDirectory || "/workspace";
        const shortDir = currentDir.split("/").pop() || "workspace";
        return `🐳 ${shortDir}$ `;
      } else {
        // Legacy filesystem prompt
        return `${terminalState.absolutePath}> `;
      }
    }
    const dir = activeTerminal?.workingDirectory || "";
    const shortDir = dir.split("/").pop() || dir.split("\\").pop() || dir;
    return `${shortDir}$ `;
  };

  if (!activeTerminal && terminals.length === 0) {
    return (
      <div className="terminal">
        <div className="terminal-header">
          <div className="terminal-title">
            <FiTerminal size={16} />
            <span>Terminal</span>
          </div>
          <button className="terminal-action" onClick={createNewTerminal}>
            <FiPlus size={16} />
          </button>
        </div>
        <div className="terminal-empty">
          <FiTerminal size={48} />
          <p>No terminal available</p>
          <button className="btn btn-primary" onClick={createNewTerminal}>
            <FiPlus size={16} />
            Create Terminal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal">
      <div className="terminal-header">
        <div className="terminal-title">
          <FiTerminal size={16} />
          <span>Terminal</span>
        </div>
        <div className="terminal-tabs">
          {terminals.map((terminal) => {
            const terminalState = terminalStates[terminal.id] || {};
            const isRecovered = terminalState.status === 'recovered';
            const needsRestart = terminalState.status === 'needs-restart';
            
            return (
              <div
                key={terminal.id}
                className={`terminal-tab ${
                  activeTerminal?.id === terminal.id ? "active" : ""
                } ${isRecovered ? "recovered" : ""} ${needsRestart ? "needs-restart" : ""}`}
                onClick={() => setActiveTerminal(terminal)}
                title={
                  isRecovered ? "Container auto-recovered" :
                  needsRestart ? "Session invalid - restart required" :
                  terminal.name
                }
              >
                <span className="terminal-tab-name">
                  {isRecovered && <span className="status-indicator recovered">🔄</span>}
                  {needsRestart && <span className="status-indicator warning">⚠️</span>}
                  {terminal.name}
                </span>
                <button
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTerminal(terminal.id);
                  }}
                >
                  <FiX size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="terminal-actions">
          <button className="terminal-action" onClick={createNewTerminal}>
            <FiPlus size={16} />
          </button>
          <button className="terminal-action" onClick={clearTerminal}>
            <FiTrash2 size={16} />
          </button>
          <div className="terminal-dropdown">
            <button className="terminal-action">
              <FiMoreHorizontal size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="terminal-content">
        <div className="terminal-output" ref={outputRef}>
          {(output[activeTerminal?.id] || []).map((item, index) => (
            <div key={index} className={`terminal-line ${item.type}`}>
              {item.type === "command" && (
                <>
                  <span className="prompt">{getPrompt()}</span>
                  <span className="command-text">{item.content}</span>
                </>
              )}
              {(item.type === "output" ||
                item.type === "error" ||
                item.type === "system" ||
                item.type === "program-result") && (
                <pre className="output-text">{item.content}</pre>
              )}
            </div>
          ))}
          {isExecuting && (
            <div className="terminal-line executing">
              <span className="loading-spinner">●</span>
              <span>Executing...</span>
            </div>
          )}
        </div>

        <div className="terminal-input-area">
          {showSuggestions && suggestions.length > 0 && (
            <div className="terminal-suggestions">
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  className={`suggestion-item ${
                    index === selectedSuggestion ? "selected" : ""
                  }`}
                  onClick={() => {
                    setInput(suggestion.text);
                    setShowSuggestions(false);
                  }}
                >
                  <div className="suggestion-main">
                    <div className={`suggestion-icon ${suggestion.type}`}>
                      {suggestion.type === "command" ? "⚡" : "🚀"}
                    </div>
                    <span className="suggestion-text">{suggestion.text}</span>
                    <span className="suggestion-description">
                      {suggestion.description}
                    </span>
                  </div>
                </div>
              ))}
              <div className="suggestion-help">
                Press Tab to complete, ↑↓ to navigate, Esc to close
              </div>
            </div>
          )}

          <div className="terminal-input-line">
            <span className="prompt">{getPrompt()}</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type a command (e.g., python main.py, ls, git status)..."
              disabled={isExecuting}
              className="terminal-input"
            />
            {isExecuting && <div className="input-spinner">⏳</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Terminal;
