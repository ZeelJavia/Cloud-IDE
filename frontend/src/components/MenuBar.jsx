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
  FiClock,
  FiChevronDown,
  FiEdit,
  FiMail,
  FiShield,
} from "react-icons/fi";
import { VscTerminal, VscCopilot } from "react-icons/vsc";
import { api, tokenManager } from "../lib/api";
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
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [profileData, setProfileData] = useState({
    name: user?.name || "",
    email: user?.email || "",
  });
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  }));

  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  React.useEffect(() => {
    // Update profile data when user changes
    if (user) {
      setProfileData({
        name: user.name || "",
        email: user.email || "",
      });
    }
  }, [user]);

  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (showUserMenu && !event.target.closest('.user-menu')) {
        setShowUserMenu(false);
      }
      if (showProjectMenu && !event.target.closest('.menu-item')) {
        setShowProjectMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu, showProjectMenu]);

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

  const handleProfileUpdate = async () => {
    try {
      const token = tokenManager.getToken();
      const response = await api.updateProfile(profileData, token);
      
      // Update localStorage with new user data
      localStorage.setItem("user", JSON.stringify(response.user));
      
      // If there's an onUserUpdate callback, call it to update App state
      if (typeof window !== 'undefined') {
        // Trigger a custom event to update user state in App component
        window.dispatchEvent(new CustomEvent('userProfileUpdated', {
          detail: response.user
        }));
      }
      
      toast.success(response.message || "Profile updated successfully!");
      setShowProfileModal(false);
    } catch (error) {
      console.error("Profile update error:", error);
      toast.error(error.data?.error || "Failed to update profile");
    }
  };

  const handleProfileKeyPress = (e) => {
    if (e.key === "Enter") {
      handleProfileUpdate();
    } else if (e.key === "Escape") {
      setShowProfileModal(false);
      setProfileData({
        name: user?.name || "",
        email: user?.email || "",
      });
    }
  };

  const closeUserMenu = () => {
    setShowUserMenu(false);
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
          <div className="menu-item time-display">
            <FiClock size={16} />
            <span>{currentTime}</span>
          </div>

          {/* User Menu */}
          {user && (
            <div className="user-menu">
              <div 
                className="user-info"
                onClick={() => setShowUserMenu(!showUserMenu)}
              >
                <FiUser size={16} />
                <span className="user-name">{user.name || user.email}</span>
                <FiChevronDown 
                  size={12} 
                  className={`user-dropdown-arrow ${showUserMenu ? 'rotated' : ''}`}
                />
              </div>
              {showUserMenu && (
                <div className="user-dropdown">
                  <div className="user-profile-header">
                    <div className="user-profile-info">
                      <div className="user-avatar-placeholder">
                        <FiUser size={20} />
                      </div>
                      <div className="user-details">
                        <div className="user-display-name">{user.name}</div>
                        <div className="user-email">{user.email}</div>
                        <div className="user-provider">
                          <FiShield size={10} />
                          Signed in with {user.provider || 'Google'}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="user-dropdown-separator"></div>
                  <div 
                    className="user-dropdown-item" 
                    onClick={() => {
                      setShowProfileModal(true);
                      closeUserMenu();
                    }}
                  >
                    <FiEdit size={14} />
                    Edit Profile
                  </div>
                  <div className="user-dropdown-item" onClick={onGoHome}>
                    <FiHome size={14} />
                    Home
                  </div>
                  <div className="user-dropdown-separator"></div>
                  <div 
                    className="user-dropdown-item logout-item" 
                    onClick={() => {
                      closeUserMenu();
                      onLogout();
                    }}
                  >
                    <FiLogOut size={14} />
                    Sign Out
                  </div>
                </div>
              )}
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
      {/* Profile Edit Modal */}
      {showProfileModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowProfileModal(false)}
        >
          <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Edit Profile</h3>
              <button
                className="modal-close"
                onClick={() => setShowProfileModal(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="profile-avatar-section">
                <div className="profile-avatar-placeholder-large">
                  <FiUser size={32} />
                </div>
                <div className="profile-provider-info">
                  <div className="provider-badge">
                    <FiShield size={12} />
                    {user.provider || 'Google'} Account
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">
                  <FiUser size={14} />
                  Display Name
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={profileData.name}
                  onChange={(e) => setProfileData({...profileData, name: e.target.value})}
                  onKeyPress={handleProfileKeyPress}
                  placeholder="Enter your display name..."
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  <FiMail size={14} />
                  Email Address
                </label>
                <input
                  type="email"
                  className="form-input"
                  value={profileData.email}
                  disabled={user.provider === 'google'}
                  onChange={(e) => setProfileData({...profileData, email: e.target.value})}
                  placeholder="Enter your email..."
                />
                {user.provider === 'google' && (
                  <div className="form-help">
                    Email cannot be changed for Google accounts
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowProfileModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleProfileUpdate}
                disabled={!profileData.name.trim()}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MenuBar;
