const path = require("path");

function sanitizePath(p) {
  if (!p) return "";
  const clean = p
    .replace(/\\/g, "/")
    .replace(/\.{2,}/g, "..") // preserve but check below
    .replace(/\/+$/, "")
    .replace(/^\/+/, "");
  if (clean.split("/").some((seg) => seg === "..")) {
    throw new Error("Invalid path segment");
  }
  return clean;
}

function buildTree(files) {
  const root = [];
  const dirMap = new Map(); // path -> node
  function ensureDir(dirPath) {
    if (!dirPath) return root;
    if (dirMap.has(dirPath)) return dirMap.get(dirPath);
    const parts = dirPath.split("/").filter(Boolean);
    let curArr = root;
    let acc = "";
    let lastNode = null;
    for (const part of parts) {
      acc = acc ? acc + "/" + part : part;
      if (!dirMap.has(acc)) {
        const node = { name: part, path: acc, type: "folder", children: [] };
        dirMap.set(acc, node);
        curArr.push(node);
        lastNode = node;
      }
      curArr = dirMap.get(acc).children;
    }
    return dirMap.get(dirPath) || lastNode;
  }
  for (const f of files) {
    const dir = f.path.includes("/")
      ? f.path.slice(0, f.path.lastIndexOf("/"))
      : "";

    if (f.type === "folder") {
      // For explicit folder entries, ensure the folder exists
      ensureDir(f.path);
    } else {
      // For files, ensure parent directory exists then add the file
      if (dir) ensureDir(dir);
      const target = dir ? dirMap.get(dir).children : root;
      target.push({
        name: f.name,
        path: f.path,
        type: f.type,
        size: f.size,
        language: f.language,
      });
    }
  }
  return root;
}

module.exports = { buildTree, sanitizePath };
