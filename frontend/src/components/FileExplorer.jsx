import React, { useState, useEffect } from "react";
import {
  FiFolder,
  FiFile,
  FiChevronRight,
  FiChevronDown,
  FiPlus,
  FiMoreHorizontal,
  FiRefreshCw,
  FiTrash2,
  FiEdit3,
} from "react-icons/fi";
import { VscNewFile, VscNewFolder } from "react-icons/vsc";
import { api } from "../lib/api";
import "./FileExplorer.css";

/**
 * FileExplorer - Project file tree with create, delete, and navigation functionality
 */
const FileExplorer = ({
  project,
  socket,
  refreshTick = 0,
  onFileSelect,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
}) => {
  const [fileTree, setFileTree] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [currentFolder, setCurrentFolder] = useState(null); // Track current folder context
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createType, setCreateType] = useState("file"); // 'file' or 'folder'
  const [newItemName, setNewItemName] = useState("");

  useEffect(() => {
    if (project) {
      loadFileTree();
    } else {
      setFileTree([]);
    }
  }, [project]);

  // Reload tree when parent toggles refreshTick
  useEffect(() => {
    if (project) loadFileTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  // Listen for file-updated broadcasts to refresh
  useEffect(() => {
    if (!socket || !project) return;
    const onUpdated = (data) => {
      if (!data || data.projectName !== (project.name || project.id)) return;
      loadFileTree();
    };
    socket.on("file-updated", onUpdated);
    return () => socket.off("file-updated", onUpdated);
  }, [socket, project]);

  const loadFileTree = async () => {
    if (!project) return;

    try {
      setLoading(true);
      const projectName = typeof project === "string" ? project : project.name;
      const token = localStorage.getItem("token");
      const tree = await api.getTree(projectName, token);
      setFileTree(tree);
    } catch (error) {
      console.error("Error loading file tree:", error);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to find an item by path in the tree
  const findItemByPath = (items, targetPath) => {
    for (const item of items) {
      if (item.path === targetPath) {
        return item;
      }
      if (item.children && item.children.length > 0) {
        const found = findItemByPath(item.children, targetPath);
        if (found) return found;
      }
    }
    return null;
  };

  const toggleFolder = (folderPath) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderPath)) {
      newExpanded.delete(folderPath);
      // If closing this folder, clear current folder context
      if (currentFolder?.path === folderPath) {
        setCurrentFolder(null);
      }
    } else {
      newExpanded.add(folderPath);
      // When expanding a folder, set it as current folder context
      const folder = findItemByPath(fileTree, folderPath);
      if (folder) {
        setCurrentFolder(folder);
      }
    }
    setExpandedFolders(newExpanded);
  };

  const handleContextMenu = (e, item) => {
    e.preventDefault();
    e.stopPropagation();

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      item,
    });
    setSelectedItem(item);
  };

  const closeContextMenu = () => {
    setContextMenu(null);
    setSelectedItem(null);
  };

  const handleCreateItem = (type, parentPath = null) => {
    setCreateType(type);
    setShowCreateModal(true);
    setNewItemName("");
    closeContextMenu();
  };

  const confirmCreateItem = async () => {
    if (!newItemName.trim()) return;

    // Use selectedItem first, then currentFolder, then project root
    const parentPath =
      selectedItem?.path || currentFolder?.path || project?.path || "";

    console.log("🔧 FileExplorer create item debug:", {
      selectedItem: selectedItem?.path,
      currentFolder: currentFolder?.path,
      projectPath: project?.path,
      finalParentPath: parentPath,
      newItemName,
      createType,
    });

    try {
      if (createType === "file") {
        await onCreateFile(parentPath, newItemName);
      } else {
        await onCreateFolder(parentPath, newItemName);
      }
      await loadFileTree();
      setShowCreateModal(false);
      setNewItemName("");
    } catch (error) {
      console.error("Error creating item:", error);
    }
  };

  const handleDeleteItem = async (item) => {
    if (window.confirm(`Are you sure you want to delete "${item.name}"?`)) {
      try {
        await onDeleteFile(item.path);
        await loadFileTree();
      } catch (error) {
        console.error("Error deleting item:", error);
      }
    }
    closeContextMenu();
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
      cpp: "⚡",
      c: "⚡",
      php: "🐘",
      go: "🐹",
      rs: "🦀",
      vue: "💚",
      svelte: "🧡",
      sql: "🗃️",
      xml: "📄",
      yaml: "⚙️",
      yml: "⚙️",
      txt: "📄",
      pdf: "📕",
      png: "🖼️",
      jpg: "🖼️",
      jpeg: "🖼️",
      gif: "🖼️",
      svg: "🖼️",
      ico: "🖼️",
    };

    return iconMap[ext] || "📄";
  };

  const renderFileTree = (items, level = 0) => {
    return items.map((item) => (
      <div key={item.path} className={`file-item level-${level}`}>
        <div
          className={`file-item-content ${
            selectedItem?.path === item.path ? "selected" : ""
          }`}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => {
            if (item.type === "file") {
              onFileSelect(item.path);
            } else {
              toggleFolder(item.path);
              // Set current folder context when clicking on a folder
              setCurrentFolder(item);
            }
            setSelectedItem(item);
          }}
          onContextMenu={(e) => handleContextMenu(e, item)}
        >
          {item.type === "folder" && (
            <span className="folder-toggle">
              {expandedFolders.has(item.path) ? (
                <FiChevronDown size={12} />
              ) : (
                <FiChevronRight size={12} />
              )}
            </span>
          )}

          <span className="file-icon">
            {item.type === "folder" ? (
              <FiFolder size={14} />
            ) : (
              <span className="file-emoji">{getFileIcon(item.name)}</span>
            )}
          </span>

          <span className="file-name">{item.name}</span>
        </div>

        {item.type === "folder" && expandedFolders.has(item.path) && (
          <div
            className="folder-content"
            onContextMenu={(e) => {
              // Right-click in empty folder space should set that folder as context
              if (e.target.classList.contains("folder-content")) {
                e.preventDefault();
                e.stopPropagation();
                setCurrentFolder(item);
                setSelectedItem(null); // Clear selected item so we use currentFolder
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  item: null, // No specific item selected, just folder context
                });
              }
            }}
          >
            {item.children && renderFileTree(item.children, level + 1)}
          </div>
        )}
      </div>
    ));
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      confirmCreateItem();
    } else if (e.key === "Escape") {
      setShowCreateModal(false);
      setNewItemName("");
    }
  };

  useEffect(() => {
    const handleClickOutside = () => closeContextMenu();
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  if (!project) {
    return (
      <div className="file-explorer">
        <div className="explorer-header">
          <h3>Explorer</h3>
        </div>
        <div className="no-project">
          <p>No project open</p>
          <p className="text-secondary">Open a project to view files</p>
        </div>
      </div>
    );
  }

  return (
    <div className="file-explorer">
      <div className="explorer-header">
        <h3>{project.name}</h3>
        <div className="explorer-actions">
          <button
            className="action-btn"
            onClick={() => handleCreateItem("file")}
            title="New File"
          >
            <VscNewFile size={16} />
          </button>
          <button
            className="action-btn"
            onClick={() => handleCreateItem("folder")}
            title="New Folder"
          >
            <VscNewFolder size={16} />
          </button>
          <button className="action-btn" onClick={loadFileTree} title="Refresh">
            <FiRefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="explorer-content">
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <span>Loading files...</span>
          </div>
        ) : (
          <div className="file-tree">
            {fileTree.length > 0 ? (
              renderFileTree(fileTree)
            ) : (
              <div className="empty-project">
                <p>No files in project</p>
                <button
                  className="btn btn-primary"
                  onClick={() => handleCreateItem("file")}
                >
                  Create First File
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            position: "fixed",
          }}
        >
          <div
            className="context-menu-item"
            onClick={() => handleCreateItem("file")}
          >
            <VscNewFile size={14} />
            New File
          </div>
          <div
            className="context-menu-item"
            onClick={() => handleCreateItem("folder")}
          >
            <VscNewFolder size={14} />
            New Folder
          </div>
          <div className="context-menu-separator"></div>
          {selectedItem && (
            <>
              <div
                className="context-menu-item"
                onClick={() => handleDeleteItem(selectedItem)}
              >
                <FiTrash2 size={14} />
                Delete
              </div>
              <div className="context-menu-item">
                <FiEdit3 size={14} />
                Rename
              </div>
            </>
          )}
        </div>
      )}

      {/* Create Item Modal */}
      {showCreateModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowCreateModal(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                Create New {createType === "file" ? "File" : "Folder"}
              </h3>
              <button
                className="modal-close"
                onClick={() => setShowCreateModal(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  {createType === "file" ? "File" : "Folder"} Name
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={`Enter ${createType} name...`}
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
                onClick={confirmCreateItem}
                disabled={!newItemName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileExplorer;
