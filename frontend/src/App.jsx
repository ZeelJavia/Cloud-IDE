import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import { toast } from "react-toastify";
import { api, getSocketUrl, tokenManager } from "./lib/api";
import MenuBar from "./components/MenuBar";
import FileExplorer from "./components/FileExplorer";
import CodeEditor from "./components/CodeEditor";
import AIPanel from "./components/AIPanel";
import Terminal from "./components/Terminal";
import { LandingPage } from "./components/landing-page";
import { AuthPage } from "./components/auth-page";
import "./App.css";

/**
 * Main App component - Orchestrates IDE interface, projects, and real-time communication
 */
const App = () => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState("landing"); // 'landing', 'auth', 'ide'
  const [socket, setSocket] = useState(null);
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [fileContents, setFileContents] = useState({});

  // Handle login
  const handleLogin = (userData) => {
    console.log('🔐 Login successful, user data:', userData);
    setUser(userData);
    tokenManager.setToken(userData.token);
    // Store in localStorage for session persistence
    localStorage.setItem('token', userData.token);
    localStorage.setItem('user', JSON.stringify(userData));
    setIsAuthenticated(true);
    console.log('🚀 Redirecting to IDE...');
    setCurrentPage("ide");
  };

  // Handle logout
  const handleLogout = () => {
    tokenManager.clearToken();
    // Clear localStorage as well
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setIsAuthenticated(false);
    setCurrentPage("landing");
    if (socket) {
      socket.disconnect();
    }
  };

  // Handle go to IDE from landing page
  const handleGoToIDE = () => {
    if (isAuthenticated) {
      setCurrentPage("ide");
    } else {
      // Redirect to auth page if not authenticated
      setCurrentPage("auth");
    }
  };

  // Handle navigation to Auth
  const handleGoToAuth = () => {
    setCurrentPage("auth");
  };

  // Handle back to landing
  const handleBackToLanding = () => {
    setCurrentPage("landing");
  };

  const loadBool = (k, def) => {
    try {
      const v = localStorage.getItem(k);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  };

  const [aiPanelVisible, setAiPanelVisible] = useState(() =>
    loadBool("ide.aiVisible", true)
  );
  const [terminalVisible, setTerminalVisible] = useState(() =>
    loadBool("ide.terminalVisible", true)
  );
  const [welcomeVisible, setWelcomeVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  // Layout state for CSS Grid resizers
  const SIDEBAR = {
    min: 150,
    max: 500,
    def: 220,
    snaps: [180, 220, 280, 320, 400],
  };
  const AI = { min: 280, max: 600, def: 380, snaps: [300, 380, 440, 520, 600] };
  const TERM = {
    min: 120,
    max: 500,
    def: 240,
    snaps: [160, 240, 300, 360, 420],
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const loadNum = (k, def, min, max) => {
    const v = parseInt(localStorage.getItem(k), 10);
    return Number.isFinite(v) ? clamp(v, min, max) : def;
  };
  const saveNum = (k, v) => {
    try {
      localStorage.setItem(k, String(v));
    } catch {}
  };
  const snapNearest = (v, snaps) =>
    snaps.reduce(
      (best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best),
      snaps[0]
    );

  const [sidebarWidth, setSidebarWidth] = useState(() =>
    loadNum("ide.sidebarWidth", SIDEBAR.def, SIDEBAR.min, SIDEBAR.max)
  );
  const [aiWidth, setAiWidth] = useState(() =>
    loadNum("ide.aiWidth", AI.def, AI.min, AI.max)
  );
  const [terminalHeight, setTerminalHeight] = useState(() =>
    loadNum("ide.terminalHeight", TERM.def, TERM.min, TERM.max)
  );
  const dragStateRef = useRef({ type: null });

  // Initialize authentication check
  useEffect(() => {
    const checkAuth = async () => {
      // First, check if we have OAuth callback parameters in URL
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      const userParam = urlParams.get('user');
      
      if (token && userParam) {
        try {
          // OAuth callback - user just returned from Google auth
          const user = JSON.parse(decodeURIComponent(userParam));
          const userWithToken = { ...user, token };
          tokenManager.setToken(token);
          // Store in localStorage for session persistence
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(userWithToken));
          setUser(userWithToken);
          setIsAuthenticated(true);
          console.log('🔐 OAuth login successful, redirecting to IDE...');
          setCurrentPage("ide"); // Go directly to IDE after OAuth
          
          // Clean up URL parameters
          window.history.replaceState({}, '', window.location.pathname);
          setAuthLoading(false);
          return;
        } catch (error) {
          console.error("OAuth callback error:", error);
          // Clear URL parameters if there was an error
          window.history.replaceState({}, '', window.location.pathname);
        }
      }

      // Check for existing session in localStorage (for development convenience)
      const storedToken = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');
      
      if (storedToken && storedUser) {
        try {
          // Verify token is still valid
          const userData = JSON.parse(storedUser);
          console.log('🔄 Restoring session for user:', userData.email || userData.name);
          tokenManager.setToken(storedToken);
          setUser(userData);
          setIsAuthenticated(true);
          console.log('🚀 Session restored, redirecting to IDE...');
          setCurrentPage("ide");
        } catch (error) {
          console.error("Session restoration error:", error);
          // Clear invalid stored data
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      }
      
      setAuthLoading(false);
    };

    checkAuth();
  }, []);

  // Initialize socket connection on mount; include token if present
  useEffect(() => {
    const newSocket = io(getSocketUrl(), {
      auth: {
        token: tokenManager.getToken() || undefined,
      },
    });
    setSocket(newSocket);
    socketRef.current = newSocket;

    newSocket.on("connect", () => {
      setConnected(true);
      toast.success("Connected to server");
    });

    newSocket.on("disconnect", () => {
      setConnected(false);
      toast.error("Disconnected from server");
    });

    newSocket.on("file-updated", (data) => {
      const { filePath, content } = data;
      setFileContents((prev) => ({
        ...prev,
        [filePath]: content,
      }));
      toast.info(`File updated: ${filePath.split("/").pop()}`);
    });

    newSocket.on("project-updated", () => {
      loadProjects();
    });

    newSocket.on("error", (error) => {
      toast.error(error.message || "An error occurred");
    });

    // Listen for profile updates
    const handleProfileUpdate = (event) => {
      setUser(event.detail);
    };

    window.addEventListener('userProfileUpdated', handleProfileUpdate);

    return () => {
      newSocket.close();
      window.removeEventListener('userProfileUpdated', handleProfileUpdate);
    };
  }, []);

  // Load projects on mount
  useEffect(() => {
    if (isAuthenticated) {
      loadProjects();
    }
  }, [isAuthenticated]);

  // Join/leave project room when currentProject changes
  useEffect(() => {
    if (!socket) return;
    const projectName = currentProject?.name || currentProject?.id;
    if (!projectName) return;
    socket.emit("join-project", projectName);
    return () => {
      socket.emit("leave-project", projectName);
    };
  }, [socket, currentProject?.name]);

  const loadProjects = async () => {
    try {
      // Ensure we have a valid token before making the request
      const token = tokenManager.getToken();
      console.log('🔐 Loading projects with token:', token ? 'present' : 'missing');
      const data = await api.listProjects(token);
      // Convert string array to objects with id and name
      const projectObjects = data.map((projectName) => ({
        id: projectName,
        name: projectName,
      }));
      setProjects(projectObjects);
    } catch (error) {
      console.error("Error loading projects:", error);
      if (error.status === 401) {
        // Unauthorized - redirect to login
        handleLogout();
      } else {
        toast.error("Failed to load projects");
      }
    }
  };

  const [treeRefreshTick, setTreeRefreshTick] = useState(0);

  /**
   * Create new project in database and update projects list
   */
  const createProject = async (projectName) => {
    try {
      setLoading(true);
      await api.createProject(projectName);
      await loadProjects(); // Reload projects list
      setCurrentProject({ name: projectName }); // Set the new project as current
      toast.success(`Project "${projectName}" created successfully`);
    } catch (error) {
      console.error("Error creating project:", error);
      toast.error(error.data?.error || "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  const deleteProject = async (projectId) => {
    try {
      setLoading(true);
      await api.deleteProject(projectId);

      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (currentProject && currentProject.name === projectId) {
        setCurrentProject(null);
        setOpenFiles([]);
        setActiveFile(null);
        setFileContents({});
      }
      toast.success("Project deleted successfully");
    } catch (error) {
      toast.error("Failed to delete project");
      console.error("Error deleting project:", error);
    } finally {
      setLoading(false);
    }
  };

  const openProject = (project) => {
    setCurrentProject(project);
    setOpenFiles([]);
    setActiveFile(null);
    setFileContents({});
  };

  /**
   * Load and display selected file in editor with content fetching
   */
  const openFile = async (filePath) => {
    try {
      if (!currentProject) {
        toast.error("No project selected");
        return;
      }

      if (!openFiles.find((f) => f.path === filePath)) {
        // The filePath from FileExplorer is just the relative path, not full path
        const relativePath = filePath;

        try {
          const result = await api.readFile(
            currentProject.name,
            relativePath
          );
          const fileName = filePath.split("/").pop();
          const newFile = {
            path: filePath,
            name: fileName,
            content: result.content,
          };

          setOpenFiles((prev) => [...prev, newFile]);
          setFileContents((prev) => ({ ...prev, [filePath]: result.content }));
          setActiveFile(newFile);
        } catch (error) {
          console.error("Error opening file:", error);
          toast.error("Failed to open file");
        }
      } else {
        const file = openFiles.find((f) => f.path === filePath);
        setActiveFile(file);
      }
    } catch (error) {
      toast.error("Failed to open file");
      console.error("Error opening file:", error);
    }
  };

  const closeFile = (filePath) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== filePath));
    const updatedFiles = openFiles.filter((f) => f.path !== filePath);

    if (activeFile && activeFile.path === filePath) {
      setActiveFile(
        updatedFiles.length > 0 ? updatedFiles[updatedFiles.length - 1] : null
      );
    }

    setFileContents((prev) => {
      const newContents = { ...prev };
      delete newContents[filePath];
      return newContents;
    });
  };

  /**
   * Save file content to database and update UI state
   */
  const saveFile = async (filePath, content) => {
    try {
      if (!currentProject) {
        toast.error("No project selected");
        return;
      }

      // Extract relative path from the full project path
      const relativePath = filePath.replace(`${currentProject.name}/`, "");

      await api.saveFile(currentProject.name, relativePath, content);

      setFileContents((prev) => ({ ...prev, [filePath]: content }));

      // Update the file in openFiles
      setOpenFiles((prev) =>
        prev.map((file) =>
          file.path === filePath ? { ...file, content, saved: true } : file
        )
      );

      toast.success(`Saved ${filePath.split("/").pop()}`);

      // No need to emit; server broadcasts file-updated on save
    } catch (error) {
      toast.error("Failed to save file");
      console.error("Error saving file:", error);
    }
  };

  const createFile = async (parentPath, fileName) => {
    try {
      if (!currentProject) {
        toast.error("No project selected");
        return;
      }

      const fullPath = parentPath ? `${parentPath}/${fileName}` : fileName;

      await api.createEntry(currentProject.name, fullPath, "file", "");

      toast.success(`Created ${fileName}`);
      // Refresh file tree in explorer
      setTreeRefreshTick((t) => t + 1);
    } catch (error) {
      toast.error("Failed to create file");
      console.error("Error creating file:", error);
    }
  };

  const createFolder = async (parentPath, folderName) => {
    try {
      if (!currentProject) {
        toast.error("No project selected");
        return;
      }

      const fullPath = parentPath ? `${parentPath}/${folderName}` : folderName;

      await api.createEntry(currentProject.name, fullPath, "folder", "");

      toast.success(`Created folder ${folderName}`);
      // Refresh file tree
      setTreeRefreshTick((t) => t + 1);
    } catch (error) {
      console.error("Error creating folder:", error);
      const errorMsg =
        error.response?.data?.error ||
        error.message ||
        "Failed to create folder";
      toast.error(`Failed to create folder: ${errorMsg}`);
    }
  };

  const deleteFile = async (filePath) => {
    try {
      if (!currentProject) {
        toast.error("No project selected");
        return;
      }

      // Extract relative path from absolute path
      const relativePath = filePath.replace(`${currentProject.name}/`, "");

      await api.deleteEntry(currentProject.name, relativePath);

      // Close file if it's open
      closeFile(filePath);
      toast.success(`Deleted ${filePath.split("/").pop()}`);
      // Refresh file tree
      setTreeRefreshTick((t) => t + 1);
    } catch (error) {
      toast.error("Failed to delete file");
      console.error("Error deleting file:", error);
    }
  };

  const handleContentChange = (filePath, newContent) => {
    setFileContents((prev) => ({ ...prev, [filePath]: newContent }));

    // Mark file as unsaved
    setOpenFiles((prev) =>
      prev.map((file) =>
        file.path === filePath
          ? { ...file, content: newContent, saved: false }
          : file
      )
    );
  };

  // Bridge CodeEditor run results into Terminal: send lines to active terminal via socket event
  const handleEditorRunResult = (result) => {
    if (!result) return;
    try {
      window.dispatchEvent(
        new CustomEvent("ide-terminal-append", { detail: result })
      );
    } catch {}
  };

  const toggleAIPanel = () => {
    setAiPanelVisible((v) => {
      const nv = !v;
      try {
        localStorage.setItem("ide.aiVisible", JSON.stringify(nv));
      } catch {}
      return nv;
    });
  };

  const toggleTerminal = () => {
    setTerminalVisible((v) => {
      const nv = !v;
      try {
        localStorage.setItem("ide.terminalVisible", JSON.stringify(nv));
      } catch {}
      return nv;
    });
  };

  const dismissWelcome = () => {
    setWelcomeVisible(false);
  };

  // Resizer handlers
  const onDragStart = (type, startEvent) => {
    dragStateRef.current = {
      type,
      startX: startEvent.clientX,
      startY: startEvent.clientY,
      startSidebar: sidebarWidth,
      startAI: aiWidth,
      startTerminal: terminalHeight,
    };
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    startEvent.preventDefault();
  };

  const onDragMove = (e) => {
    const s = dragStateRef.current;
    if (!s || !s.type) return;
    if (s.type === "sidebar") {
      const delta = e.clientX - s.startX;
      const next = clamp(s.startSidebar + delta, SIDEBAR.min, SIDEBAR.max);
      setSidebarWidth(next);
    } else if (s.type === "ai") {
      const delta = s.startX - e.clientX; // dragging left increases width
      const next = clamp(s.startAI + delta, AI.min, AI.max);
      setAiWidth(next);
    } else if (s.type === "terminal") {
      const delta = s.startY - e.clientY; // dragging up increases editor area
      const next = clamp(s.startTerminal + delta, TERM.min, TERM.max);
      setTerminalHeight(next);
    }
    e.preventDefault();
  };

  const onDragEnd = () => {
    dragStateRef.current = { type: null };
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    // Persist sizes
    saveNum("ide.sidebarWidth", sidebarWidth);
    saveNum("ide.aiWidth", aiWidth);
    saveNum("ide.terminalHeight", terminalHeight);
  };

  // Keyboard resizing helpers
  const adjustSize = (type, delta, opts = {}) => {
    const { snap = false, toMin = false, toMax = false, reset = false } = opts;
    if (type === "sidebar") {
      let next = sidebarWidth;
      if (reset) next = SIDEBAR.def;
      else if (toMin) next = SIDEBAR.min;
      else if (toMax) next = SIDEBAR.max;
      else {
        next = sidebarWidth + delta;
        next = snap ? snapNearest(next, SIDEBAR.snaps) : next;
        next = clamp(next, SIDEBAR.min, SIDEBAR.max);
      }
      setSidebarWidth(next);
      saveNum("ide.sidebarWidth", next);
    } else if (type === "ai") {
      let next = aiWidth;
      if (reset) next = AI.def;
      else if (toMin) next = AI.min;
      else if (toMax) next = AI.max;
      else {
        next = aiWidth + delta;
        next = snap ? snapNearest(next, AI.snaps) : next;
        next = clamp(next, AI.min, AI.max);
      }
      setAiWidth(next);
      saveNum("ide.aiWidth", next);
    } else if (type === "terminal") {
      let next = terminalHeight;
      if (reset) next = TERM.def;
      else if (toMin) next = TERM.min;
      else if (toMax) next = TERM.max;
      else {
        next = terminalHeight + delta;
        next = snap ? snapNearest(next, TERM.snaps) : next;
        next = clamp(next, TERM.min, TERM.max);
      }
      setTerminalHeight(next);
      saveNum("ide.terminalHeight", next);
    }
  };

  const resizerKeyDown = (type, e) => {
    const step = e.shiftKey ? 30 : 10;
    const snap = e.ctrlKey || e.metaKey;
    if (type === "terminal") {
      if (e.key === "ArrowUp") {
        adjustSize("terminal", step, { snap });
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        adjustSize("terminal", -step, { snap });
        e.preventDefault();
      }
    } else {
      if (e.key === "ArrowLeft") {
        adjustSize(type, type === "sidebar" ? -step : step, { snap });
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        adjustSize(type, type === "sidebar" ? step : -step, { snap });
        e.preventDefault();
      }
    }
    if (e.key === "Home") {
      adjustSize(type, 0, { toMin: true });
      e.preventDefault();
    }
    if (e.key === "End") {
      adjustSize(type, 0, { toMax: true });
      e.preventDefault();
    }
    if (e.key === "Enter" || e.key === " ") {
      adjustSize(type, 0, { reset: true });
      e.preventDefault();
    }
  };

  // Show loading screen while checking authentication
  if (authLoading) {
    return (
      <div className="auth-loading">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  // Debug current state
  console.log('🎯 Current state:', { 
    currentPage, 
    isAuthenticated, 
    user: user?.email || 'none',
    authLoading 
  });

  // Landing page
  if (currentPage === "landing") {
    return (
      <LandingPage 
        onGetStarted={handleGoToAuth} 
        onGoToEditor={handleGoToIDE}
        isAuthenticated={isAuthenticated}
        user={user}
      />
    );
  }

  // Auth page
  if (currentPage === "auth") {
    return (
      <AuthPage onBackToHome={handleBackToLanding} onLogin={handleLogin} />
    );
  }

  // Show IDE if authenticated
  return (
    <div className="app">
      <MenuBar
        currentProject={currentProject}
        projects={projects}
        onCreateProject={createProject}
        onDeleteProject={deleteProject}
        onOpenProject={openProject}
        onToggleAIPanel={toggleAIPanel}
        onToggleTerminal={toggleTerminal}
        connected={connected}
        loading={loading}
        user={user}
        onLogout={handleLogout}
        onGoHome={handleBackToLanding}
      />
      <div
        className="app-body layout-grid"
        style={{
          "--sidebar-width": `${sidebarWidth}px`,
          "--ai-width": aiPanelVisible ? `${aiWidth}px` : "0px",
          "--terminal-height": terminalVisible ? `${terminalHeight}px` : "0px",
          "--ai-resizer-width": aiPanelVisible ? "2px" : "0px",
        }}
      >
        {/* Column 1: File Explorer */}
        <div className="grid-sidebar">
          <FileExplorer
            project={currentProject}
            socket={socket}
            refreshTick={treeRefreshTick}
            onFileSelect={openFile}
            onCreateFile={createFile}
            onCreateFolder={createFolder}
            onDeleteFile={deleteFile}
          />
        </div>

        {/* Resizer between sidebar and main */}
        <div
          className="g-resizer vertical left"
          onMouseDown={(e) => onDragStart("sidebar", e)}
          onDoubleClick={() => adjustSize("sidebar", 0, { reset: true })}
          onKeyDown={(e) => resizerKeyDown("sidebar", e)}
          role="separator"
          tabIndex={0}
          aria-label="Resize sidebar"
          aria-orientation="vertical"
        />

        {/* Column 3: Main (editor + terminal) as a rows grid */}
        <div className={`grid-main ${terminalVisible ? "has-terminal" : ""}`}>
          <div className="grid-editor">
            <CodeEditor
              files={openFiles}
              activeFile={activeFile}
              fileContents={fileContents}
              onFileSelect={setActiveFile}
              onFileClose={closeFile}
              onContentChange={handleContentChange}
              onSave={saveFile}
              onRun={handleEditorRunResult}
              currentProject={currentProject}
              welcomeVisible={welcomeVisible}
              onDismissWelcome={dismissWelcome}
            />
          </div>
          {terminalVisible && (
            <>
              <div
                className="g-resizer horizontal"
                onMouseDown={(e) => onDragStart("terminal", e)}
                onDoubleClick={() => adjustSize("terminal", 0, { reset: true })}
                onKeyDown={(e) => resizerKeyDown("terminal", e)}
                role="separator"
                tabIndex={0}
                aria-label="Resize terminal"
                aria-orientation="horizontal"
              />
              <div className="grid-terminal">
                <Terminal
                  project={currentProject}
                  socket={socket}
                  user={user}
                />
              </div>
            </>
          )}
        </div>

        {/* Resizer between main and AI panel (only when visible) */}
        {aiPanelVisible && (
          <div
            className="g-resizer vertical right"
            onMouseDown={(e) => onDragStart("ai", e)}
            onDoubleClick={() => adjustSize("ai", 0, { reset: true })}
            onKeyDown={(e) => resizerKeyDown("ai", e)}
            role="separator"
            tabIndex={0}
            aria-label="Resize AI panel"
            aria-orientation="vertical"
          />
        )}

        {/* Column 5: AI Panel */}
        {aiPanelVisible && (
          <div className="grid-ai">
            <AIPanel
              activeFile={activeFile}
              fileContents={fileContents}
              onContentUpdate={handleContentChange}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
