import React, { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  FiX,
  FiSave,
  FiMoreHorizontal,
  FiPlay,
  FiSliders,
} from "react-icons/fi";
import { VscCircleFilled } from "react-icons/vsc";
import { api } from "../lib/api";
import RunConfigModal from "./RunConfigModal";
import "./CodeEditor.css";

const CodeEditor = ({
  files,
  activeFile,
  fileContents,
  onFileSelect,
  onFileClose,
  onContentChange,
  onSave,
  currentProject,
  onRun, // optional handler to stream output into Terminal
  welcomeVisible = true,
  onDismissWelcome,
}) => {
  const editorRef = useRef(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showRunConfig, setShowRunConfig] = useState(false);
  const [runConfig, setRunConfig] = useState({
    args: "",
    stdinText: "",
    docker: true,
    timeoutSec: 30,
    envVars: "", // KEY=VALUE per line
    cpus: "1.0",
    memory: "512m",
    pids: 256,
  });

  useEffect(() => {
    // Check if file has unsaved changes
    if (activeFile) {
      const currentContent = fileContents[activeFile.path] || "";
      const originalContent = activeFile.content || "";
      setHasUnsavedChanges(currentContent !== originalContent);
    }
  }, [activeFile, fileContents]);

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;

    // Configure Monaco Editor theme
    monaco.editor.defineTheme("vs-code-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6A9955" },
        { token: "keyword", foreground: "569CD6" },
        { token: "string", foreground: "CE9178" },
        { token: "number", foreground: "B5CEA8" },
        { token: "type", foreground: "4EC9B0" },
        { token: "class", foreground: "4EC9B0" },
        { token: "function", foreground: "DCDCAA" },
        { token: "variable", foreground: "9CDCFE" },
      ],
      colors: {
        "editor.background": "#1e1e1e",
        "editor.foreground": "#cccccc",
        "editor.lineHighlightBackground": "#2d2d30",
        "editor.selectionBackground": "#264f78",
        "editor.selectionHighlightBackground": "#264f7880",
        "editorCursor.foreground": "#ffffff",
        "editorWhitespace.foreground": "#404040",
        "editorIndentGuide.background": "#404040",
        "editorIndentGuide.activeBackground": "#707070",
        "editorLineNumber.foreground": "#858585",
        "editorLineNumber.activeForeground": "#c6c6c6",
      },
    });

    monaco.editor.setTheme("vs-code-dark");

    // Add keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (activeFile) {
        const content = editor.getValue();
        onSave(activeFile.path, content);
        setHasUnsavedChanges(false);
      }
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
      if (activeFile) {
        onFileClose(activeFile.path);
      }
    });
  };

  const handleEditorChange = (value) => {
    if (activeFile && value !== undefined) {
      onContentChange(activeFile.path, value);
      setHasUnsavedChanges(true);
    }
  };

  const getLanguageFromFileName = (fileName) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    const languageMap = {
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      html: "html",
      css: "css",
      scss: "scss",
      sass: "sass",
      less: "less",
      json: "json",
      xml: "xml",
      md: "markdown",
      py: "python",
      java: "java",
      cpp: "cpp",
      c: "c",
      cs: "csharp",
      php: "php",
      rb: "ruby",
      go: "go",
      rs: "rust",
      sql: "sql",
      sh: "shell",
      bash: "shell",
      ps1: "powershell",
      yaml: "yaml",
      yml: "yaml",
      toml: "ini",
      vue: "vue",
      svelte: "html",
    };
    return languageMap[ext] || "plaintext";
  };

  const getFileIcon = (fileName) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    const iconMap = {
      js: "🟨",
      jsx: "⚛️",
      ts: "🔷",
      tsx: "⚛️",
      html: "🌐",
      css: "🎨",
      json: "📋",
      md: "📝",
      py: "🐍",
      java: "☕",
    };
    return iconMap[ext] || "📄";
  };

  const handleTabClose = (e, filePath) => {
    e.stopPropagation();
    onFileClose(filePath);
  };

  const handleSave = () => {
    if (activeFile && editorRef.current) {
      const content = editorRef.current.getValue();
      onSave(activeFile.path, content);
      setHasUnsavedChanges(false);
    }
  };

  const handleRun = async (config = runConfig) => {
    if (!activeFile) return;
    try {
      const projectName = currentProject?.name || currentProject?.id;
      if (!projectName) throw new Error("No project selected");
      // Derive relative path under the project
      let relPath = activeFile.path || activeFile.name;
      if (relPath && relPath.startsWith(projectName + "/")) {
        relPath = relPath.slice(projectName.length + 1);
      }
      // Prefer streaming run via Terminal/socket (Docker-capable)
      try {
        // Handle both old and new config formats
        const argsArr = Array.isArray(config.args)
          ? config.args
          : (config.args || "").trim()
          ? (config.args || "").match(/\S+/g) || []
          : [];

        const envObj = typeof config.envVars === "object" ? config.envVars : {};
        if (typeof config.envVars === "string") {
          (config.envVars || "")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .forEach((line) => {
              const idx = line.indexOf("=");
              if (idx > 0) envObj[line.slice(0, idx)] = line.slice(idx + 1);
            });
        }

        window.dispatchEvent(
          new CustomEvent("ide-run-file", {
            detail: {
              projectName,
              filePath: relPath,
              args: argsArr,
              stdinText: config.stdinText || undefined,
              envVars: envObj,
              useDocker: !!config.docker,
              timeoutSec: Number(config.timeoutSec) || 30,
              limits: config.limits || {
                cpus: String(config.cpus || "1.0"),
                memory: String(config.memory || "512m"),
                pids: Number(config.pids || 256),
              },
            },
          })
        );
        return; // streaming will handle output
      } catch {}
      const token = localStorage.getItem("token");
      try {
        const data = await api.runFile(
          {
            projectName,
            filePath: relPath,
            args: [],
          },
          token
        );
        if (onRun) {
          onRun({
            stdout: data.stdout || "",
            stderr: data.stderr || "",
            exitCode: data.exitCode ?? 0,
          });
        }
      } catch (error) {
        if (onRun) {
          onRun({
            stdout: "",
            stderr: error.data?.error || error.message || "Run failed",
            exitCode: -1,
          });
        }
      }
    } catch (e) {
      if (onRun)
        onRun({ stdout: "", stderr: String(e.message || e), exitCode: -1 });
    }
  };

  if (files.length === 0) {
    return (
      <div className="code-editor">
        <div className="welcome-screen">
          <div className="welcome-header">
            <h3>✨ CloudSpace IDE</h3>
            {welcomeVisible && onDismissWelcome && (
              <button
                className="welcome-close-btn"
                onClick={onDismissWelcome}
                title="Close welcome screen"
              >
                <FiX size={16} />
              </button>
            )}
          </div>
          <div className="welcome-content">
            <div className="welcome-main">
              <h4>🚀 Ready to start coding?</h4>
              <p>
                Create a new file or open an existing one from the file explorer
                to begin
              </p>
            </div>
            <div className="welcome-features">
              <div className="feature">
                <span className="feature-icon">⚡</span>
                <span>AI-powered code completion</span>
              </div>
              <div className="feature">
                <span className="feature-icon">🔧</span>
                <span>Real-time collaboration</span>
              </div>
              <div className="feature">
                <span className="feature-icon">🎨</span>
                <span>Syntax highlighting for 100+ languages</span>
              </div>
              <div className="feature">
                <span className="feature-icon">☁️</span>
                <span>Cloud-native development environment</span>
              </div>
            </div>
            <div className="welcome-shortcuts">
              <h5>Quick shortcuts:</h5>
              <div className="shortcut">
                <kbd>Ctrl+S</kbd> <span>Save file</span>
              </div>
              <div className="shortcut">
                <kbd>Ctrl+W</kbd> <span>Close file</span>
              </div>
              <div className="shortcut">
                <kbd>F5</kbd> <span>Run file</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="code-editor">
      <div className="editor-tabs">
        <div className="tabs-container">
          {files.map((file) => (
            <div
              key={file.path}
              className={`editor-tab ${
                activeFile?.path === file.path ? "active" : ""
              }`}
              onClick={() => onFileSelect(file)}
            >
              <span className="tab-icon">{getFileIcon(file.name)}</span>
              <span className="tab-label">{file.name}</span>
              {file.saved === false && (
                <VscCircleFilled size={8} className="unsaved-indicator" />
              )}
              <button
                className="tab-close"
                onClick={(e) => handleTabClose(e, file.path)}
                title="Close"
              >
                <FiX size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="editor-actions">
          <button
            className="action-btn"
            onClick={handleRun}
            disabled={!activeFile}
            title="Run file"
          >
            <FiPlay size={16} />
          </button>
          <button
            className="action-btn"
            onClick={() => setShowRunConfig((v) => !v)}
            disabled={!activeFile}
            title="Run configuration"
          >
            <FiSliders size={16} />
          </button>
          <button
            className="action-btn"
            onClick={handleSave}
            disabled={!activeFile || !hasUnsavedChanges}
            title="Save (Ctrl+S)"
          >
            <FiSave size={16} />
          </button>
          <button className="action-btn" title="More actions">
            <FiMoreHorizontal size={16} />
          </button>
        </div>
      </div>

      <div className="editor-container">
        {activeFile && (
          <Editor
            height="100%"
            language={getLanguageFromFileName(activeFile.name)}
            value={fileContents[activeFile.path] || ""}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
            loading={<div className="editor-loading">Loading editor...</div>}
            options={{
              fontSize: 14,
              fontFamily: '"Fira Code", "Monaco", "Menlo", monospace',
              fontLigatures: true,
              lineNumbers: "on",
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
              wordWrap: "on",
              folding: true,
              showFoldingControls: "always",
              renderWhitespace: "selection",
              renderControlCharacters: true,
              renderIndentGuides: true,
              cursorBlinking: "blink",
              cursorSmoothCaretAnimation: true,
              smoothScrolling: true,
              mouseWheelZoom: true,
              formatOnPaste: true,
              formatOnType: true,
              suggestOnTriggerCharacters: true,
              acceptSuggestionOnEnter: "on",
              snippetSuggestions: "top",
              wordBasedSuggestions: true,
              contextmenu: true,
              multiCursorModifier: "ctrlCmd",
              selectOnLineNumbers: true,
              glyphMargin: true,
              fixedOverflowWidgets: true,
              overviewRulerLanes: 3,
              bracketPairColorization: { enabled: true },
              guides: {
                bracketPairs: true,
                indentation: true,
              },
            }}
          />
        )}
      </div>

      {activeFile && (
        <div className="editor-status">
          <span className="file-info">
            {activeFile.name} • {getLanguageFromFileName(activeFile.name)}
          </span>
          {hasUnsavedChanges && (
            <span className="unsaved-status">• Unsaved changes</span>
          )}
        </div>
      )}

      <RunConfigModal
        isOpen={showRunConfig}
        onClose={() => setShowRunConfig(false)}
        onRun={handleRun}
        activeFile={activeFile}
        initialConfig={runConfig}
      />
    </div>
  );
};

export default CodeEditor;
