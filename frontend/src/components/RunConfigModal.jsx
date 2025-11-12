import React, { useState, useEffect } from "react";
import {
  FiX,
  FiPlay,
  FiSettings,
  FiTerminal,
  FiClock,
  FiLayers,
  FiCode,
} from "react-icons/fi";
import "./RunConfigModal.css";

const RunConfigModal = ({
  isOpen,
  onClose,
  onRun,
  activeFile,
  initialConfig = {},
}) => {
  const [config, setConfig] = useState({
    args: "",
    stdinText: "",
    docker: true,
    timeoutSec: 30,
    envVars: "",
    cpus: "1.0",
    memory: "512m",
    pids: 256,
    ...initialConfig,
  });

  const [showCopySuccess, setShowCopySuccess] = useState(false);

  // Update config
  const updateConfig = (key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  // Parse environment variables
  const parseEnvVars = () => {
    const envObj = {};
    (config.envVars || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const idx = line.indexOf("=");
        if (idx > 0) {
          envObj[line.slice(0, idx)] = line.slice(idx + 1);
        }
      });
    return envObj;
  };

  // Parse arguments
  const parseArgs = () => {
    return (config.args || "").trim()
      ? (config.args || "").match(/\S+/g) || []
      : [];
  };

  // Handle run
  const handleRun = () => {
    const runData = {
      ...config,
      args: parseArgs(),
      envVars: parseEnvVars(),
      limits: {
        cpus: String(config.cpus || "1.0"),
        memory: String(config.memory || "512m"),
        pids: Number(config.pids || 256),
      },
    };
    onRun(runData);
    onClose();
  };

  // Reset to defaults
  const resetConfig = () => {
    setConfig({
      args: "",
      stdinText: "",
      docker: true,
      timeoutSec: 30,
      envVars: "",
      cpus: "1.0",
      memory: "512m",
      pids: 256,
    });
  };

  // Copy configuration
  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      setShowCopySuccess(true);
      setTimeout(() => setShowCopySuccess(false), 2000);
    } catch (e) {
      console.warn("Failed to copy configuration:", e);
    }
  };

  // Get file extension and language
  const getFileInfo = () => {
    if (!activeFile) return { ext: "", lang: "unknown" };
    const ext = activeFile.name.split(".").pop()?.toLowerCase() || "";
    const langMap = {
      js: "Node.js",
      jsx: "React",
      ts: "TypeScript",
      tsx: "React TS",
      py: "Python",
      java: "Java",
      c: "C",
      cpp: "C++",
      go: "Go",
      rs: "Rust",
      php: "PHP",
      rb: "Ruby",
    };
    return { ext, lang: langMap[ext] || ext.toUpperCase() };
  };

  const { ext, lang } = getFileInfo();

  if (!isOpen) return null;

  return (
    <div className="run-config-overlay">
      <div className="run-config-modal">
        {/* Header */}
        <div className="run-config-header">
          <div className="header-left">
            <div className="header-icon">
              <FiSettings />
            </div>
            <div className="header-info">
              <h2>Run Configuration</h2>
              {activeFile && (
                <p className="header-subtitle">
                  <FiCode className="file-icon" />
                  {activeFile.name} • {lang}
                </p>
              )}
            </div>
          </div>
          <div className="header-actions">
            <button
              className="action-btn close"
              onClick={onClose}
              title="Close"
            >
              <FiX />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="run-config-content">
          <div className="config-section">
            <div className="section-header">
              <h3>
                <FiTerminal /> Run Configuration
              </h3>
              <p>Configure how your program runs</p>
            </div>

            <div className="form-group">
              <label htmlFor="args">
                <FiCode />
                Command Line Arguments
              </label>
              <input
                id="args"
                type="text"
                value={config.args}
                onChange={(e) => updateConfig("args", e.target.value)}
                placeholder="arg1 arg2 --flag=value"
                className="form-input"
              />
              <span className="form-hint">
                Space-separated arguments passed to your program
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="stdin">
                <FiTerminal />
                Standard Input
              </label>
              <textarea
                id="stdin"
                rows={4}
                value={config.stdinText}
                onChange={(e) => updateConfig("stdinText", e.target.value)}
                placeholder="Input data for your program..."
                className="form-textarea"
              />
              <span className="form-hint">
                Text input that will be piped to your program's stdin
              </span>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="timeout">
                  <FiClock />
                  Timeout (seconds)
                </label>
                <input
                  id="timeout"
                  type="number"
                  min="1"
                  max="300"
                  value={config.timeoutSec}
                  onChange={(e) =>
                    updateConfig("timeoutSec", Number(e.target.value))
                  }
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={config.docker}
                    onChange={(e) => updateConfig("docker", e.target.checked)}
                    className="form-checkbox"
                  />
                  <FiLayers />
                  Use Docker Isolation
                </label>
                <span className="form-hint">
                  Run in secure Docker container (recommended)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="run-config-footer">
          <div className="footer-info">
            {activeFile && (
              <span className="file-info">
                Ready to run <strong>{activeFile.name}</strong>
              </span>
            )}
          </div>
          <div className="footer-actions">
            <button className="action-btn secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="action-btn primary"
              onClick={handleRun}
              disabled={!activeFile}
            >
              <FiPlay />
              Run Program
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RunConfigModal;
