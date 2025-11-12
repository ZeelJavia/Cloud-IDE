const fs = require("fs");
const path = require("path");

function getDirectoryTree(dirPath, basePath = "") {
  const items = [];

  try {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const relativePath = path.join(basePath, file);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        items.push({
          name: file,
          type: "folder",
          path: relativePath.replace(/\\/g, "/"),
          children: getDirectoryTree(fullPath, relativePath),
          size: 0,
          modified: stats.mtime,
        });
      } else {
        items.push({
          name: file,
          type: "file",
          path: relativePath.replace(/\\/g, "/"),
          size: stats.size,
          modified: stats.mtime,
          extension: path.extname(file),
          language: getFileLanguage(file),
        });
      }
    }
  } catch (error) {
    console.error("Error reading directory:", error);
  }

  return items.sort((a, b) => {
    // Folders first, then files
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function getFileLanguage(filename) {
  const ext = path.extname(filename).toLowerCase();
  const languageMap = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".sass": "sass",
    ".less": "less",
    ".py": "python",
    ".java": "java",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "c",
    ".php": "php",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
    ".md": "markdown",
    ".json": "json",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".sql": "sql",
    ".sh": "shell",
    ".bash": "shell",
    ".ps1": "powershell",
    ".dockerfile": "dockerfile",
    ".gitignore": "text",
    ".env": "text",
  };

  return languageMap[ext] || "text";
}

module.exports = {
  getDirectoryTree,
  getFileLanguage,
};
