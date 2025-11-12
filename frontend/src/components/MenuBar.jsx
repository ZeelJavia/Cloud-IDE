import React, { useState } from "react";
import { toast } from "react-toastify";
import {
  FiMenu,
  FiFolder,
  FiFile,
  FiSave,
  FiSettings,
  FiHelpCircle,
  FiWifi,
  FiWifiOff,
  FiUser,
  FiLogOut,
  FiHome,
} from "react-icons/fi";
import { VscTerminal, VscCopilot } from "react-icons/vsc";
import { api } from "../lib/api";
import "./MenuBar.css";

const MenuBar = ({
  currentProject,
  projects,
  onCreateProject,
  onDeleteProject,
  onOpenProject,
  onToggleAIPanel,
  onToggleTerminal,
  connected,
  loading,
  user,
  onLogout,
  onGoHome,
}) => {
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const handleCreateProject = () => {
    if (newProjectName.trim()) {
      onCreateProject(newProjectName.trim());
      setNewProjectName("");
      setShowCreateModal(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleCreateProject();
    } else if (e.key === "Escape") {
      setShowCreateModal(false);
      setNewProjectName("");
    }
  };

  const checkTools = async () => {
    try {
      const token = localStorage.getItem("token");
      const data = await api.checkTools(token);
      const tools = data.tools || {};
      const missing = Object.entries(tools)
        .filter(([_, v]) => !v.available)
        .map(([k]) => k);
      const ok = Object.entries(tools)
        .filter(([_, v]) => v.available)
        .slice(0, 6)
        .map(([k, v]) => `${k}: ${v.version}`)
        .join(" | ");
      if (missing.length) {
        toast.warn(`Missing: ${missing.join(", ")}`);
      }
      toast.info(ok || "No tools detected");
    } catch (e) {
      toast.error(e.message || String(e));
    }
  };

  return (
    <>
      <div className="menu-bar">
        <div className="menu-left">
          <div
            className="menu-item"
            onClick={() => setShowProjectMenu(!showProjectMenu)}
          >
            <FiMenu size={16} />
            <span>File</span>
            {showProjectMenu && (
              <div className="dropdown-menu">
                <div className="menu-section">
                  <div className="menu-section-title">Project</div>
                  <div
                    className="menu-option"
                    onClick={() => setShowCreateModal(true)}
                  >
                    <FiFolder size={14} />
                    New Project
                  </div>
                  {currentProject && (
                    <div
                      className="menu-option"
                      onClick={() => onDeleteProject(currentProject.id)}
                    >
                      <FiFolder size={14} />
                      Delete Project
                    </div>
                  )}
                </div>

                {projects.length > 0 && (
                  <div className="menu-section">
                    <div className="menu-section-title">Recent Projects</div>
                    {projects.slice(0, 5).map((project) => (
                      <div
                        key={project.id}
                        className={`menu-option ${
                          currentProject?.id === project.id ? "active" : ""
                        }`}
                        onClick={() => onOpenProject(project)}
                      >
                        <FiFolder size={14} />
                        {project.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="menu-item">
            <span>Edit</span>
          </div>

          <div className="menu-item">
            <span>View</span>
          </div>

          <div className="menu-item" onClick={onToggleTerminal}>
            <VscTerminal size={16} />
            <span>Terminal</span>
          </div>

          <div className="menu-item" onClick={onToggleAIPanel}>
            <VscCopilot size={16} />
            <span>AI Assistant</span>
          </div>
        </div>

        <div className="menu-center">
          {currentProject ? (
            <span className="project-name">{currentProject.name}</span>
          ) : (
            <span className="no-project">No Project Open</span>
          )}
        </div>

        <div className="menu-right">
          <div
            className="menu-item"
            onClick={checkTools}
            title="Check language tools"
          >
            <FiSettings size={16} />
          </div>

          <div className="menu-item">
            <FiHelpCircle size={16} />
          </div>

          {/* User Menu */}
          {user && (
            <div className="user-menu">
              <div className="user-info">
                <FiUser size={16} />
                <span className="user-name">{user.name || user.email}</span>
              </div>
              <div className="user-dropdown">
                <div className="user-dropdown-item" onClick={onGoHome}>
                  <FiHome size={14} />
                  Home
                </div>
                <div className="user-dropdown-item" onClick={onLogout}>
                  <FiLogOut size={14} />
                  Logout
                </div>
              </div>
            </div>
          )}

          <div
            className={`connection-indicator ${
              connected ? "connected" : "disconnected"
            }`}
          >
            {connected ? <FiWifi size={16} /> : <FiWifiOff size={16} />}
            <span className="connection-text">
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>

          {loading && (
            <div className="loading-indicator">
              <div className="loading-spinner"></div>
            </div>
          )}
        </div>
      </div>

      {/* Create Project Modal */}
      {showCreateModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowCreateModal(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create New Project</h3>
              <button
                className="modal-close"
                onClick={() => setShowCreateModal(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Project Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Enter project name..."
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MenuBar;
