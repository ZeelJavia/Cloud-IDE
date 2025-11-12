import React from "react";
import { FiFolder, FiFile, FiWifi, FiWifiOff, FiClock } from "react-icons/fi";
import {
  VscSourceControl,
  VscError,
  VscWarning,
  VscInfo,
} from "react-icons/vsc";
import "./StatusBar.css";

const StatusBar = ({
  currentProject,
  activeFile,
  connected,
  openFilesCount,
}) => {
  const getFileExtension = (fileName) => {
    if (!fileName) return "";
    return fileName.split(".").pop()?.toUpperCase() || "";
  };

  const getFileSize = (content) => {
    if (!content) return "0 B";
    const bytes = new Blob([content]).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getCurrentTime = () => {
    return new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="status-bar">
      <div className="status-left">
        {/* Connection Status */}
        <div
          className={`status-item connection ${
            connected ? "connected" : "disconnected"
          }`}
        >
          {connected ? <FiWifi size={14} /> : <FiWifiOff size={14} />}
          <span>{connected ? "Connected" : "Disconnected"}</span>
        </div>

        {/* Current Project */}
        {currentProject && (
          <div className="status-item project">
            <FiFolder size={14} />
            <span>{currentProject.name}</span>
          </div>
        )}

        {/* Git Branch (placeholder) */}
        <div className="status-item git">
          <VscSourceControl size={14} />
          <span>main</span>
        </div>

        {/* Problems (placeholder) */}
        <div className="status-item problems">
          <VscError size={14} />
          <span>0</span>
          <VscWarning size={14} />
          <span>0</span>
          <VscInfo size={14} />
          <span>0</span>
        </div>
      </div>

      <div className="status-center">
        {/* Open Files Count */}
        {openFilesCount > 0 && (
          <div className="status-item files-count">
            <FiFile size={14} />
            <span>
              {openFilesCount} file{openFilesCount !== 1 ? "s" : ""} open
            </span>
          </div>
        )}
      </div>

      <div className="status-right">
        {/* Active File Info */}
        {activeFile && (
          <>
            <div className="status-item file-info">
              <span className="file-extension">
                {getFileExtension(activeFile.name)}
              </span>
            </div>

            <div className="status-item encoding">
              <span>UTF-8</span>
            </div>

            <div className="status-item line-ending">
              <span>LF</span>
            </div>

            <div className="status-item cursor-position">
              <span>Ln 1, Col 1</span>
            </div>
          </>
        )}

        {/* Server Status */}
        <div className="status-item server">
          <span>Server: localhost:3001</span>
        </div>

        {/* Current Time */}
        <div className="status-item time">
          <FiClock size={14} />
          <span>{getCurrentTime()}</span>
        </div>
      </div>
    </div>
  );
};

export default StatusBar;
