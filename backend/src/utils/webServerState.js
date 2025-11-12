// Simple in-memory state for which project the web middleware should serve at root
let currentProjectName = null;

function setCurrentProject(name) {
  currentProjectName = typeof name === "string" && name.length ? name : null;
}

function getCurrentProject() {
  return currentProjectName;
}

module.exports = { setCurrentProject, getCurrentProject };
