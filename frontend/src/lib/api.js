// Centralized API client for frontend -> backend calls
// Unified API base URL detection system

// In-memory token storage to replace localStorage
let authToken = null;

export const tokenManager = {
  setToken(token) {
    authToken = token;
  },
  getToken() {
    return authToken;
  },
  clearToken() {
    authToken = null;
  }
};

const DEV =
  typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV;

// Single source of truth for API base URL
function getApiBase() {
  // 1. Check environment variables first
  if (typeof import.meta !== "undefined" && import.meta.env) {
    const explicit =
      import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL;
    if (explicit) {
      console.log(`🔧 Using explicit API base: ${explicit}`);
      return explicit;
    }
  }

  // 2. In development, use empty string for Vite proxy
  if (DEV) {
    console.log(`� Development mode: using Vite proxy`);
    return ""; // This makes /api/* go through Vite proxy to backend
  }

  // 3. Production fallback
  const fallback = "http://localhost:3001";
  console.log(`🔧 Production fallback: ${fallback}`);
  return fallback;
}

function getHeaders(token, extra = {}) {
  const h = { "Content-Type": "application/json", ...extra };
  // Use provided token or fall back to stored token
  const tokenToUse = token || authToken;
  if (tokenToUse) h.Authorization = `Bearer ${tokenToUse}`;
  return h;
}

async function handle(resp) {
  const text = await resp.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    const err = new Error(
      data?.error || data?.message || `HTTP ${resp.status}`
    );
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  baseUrl() {
    return getApiBase();
  },
  // Auth
  async register({ name, email, password, confirmPassword }) {
    const API_BASE = getApiBase();
    const resp = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ name, email, password, confirmPassword }),
    });
    return handle(resp);
  },
  async login({ email, password }) {
    const API_BASE = getApiBase();
    const resp = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ email, password }),
    });
    return handle(resp);
  },
  async verify(token) {
    const API_BASE = getApiBase();
    const resp = await fetch(`${API_BASE}/api/auth/verify`, {
      headers: getHeaders(token),
    });
    return handle(resp);
  },
  async updateProfile(profileData, token) {
    const API_BASE = getApiBase();
    const resp = await fetch(`${API_BASE}/api/auth/profile`, {
      method: "PUT",
      headers: getHeaders(token),
      body: JSON.stringify(profileData),
    });
    return handle(resp);
  },
  googleLoginUrl() {
    const API_BASE = getApiBase();
    return `${API_BASE}/api/auth/google`;
  },
  // Projects
  async listProjects(token = null) {
    const API_BASE = getApiBase();
    const resp = await fetch(`${API_BASE}/api/projects`, {
      headers: getHeaders(token),
    });
    return handle(resp); // array of names
  },
  async createProject(name, token = null) {
    const API_BASE = getApiBase();
    const resp = await fetch(`${API_BASE}/api/projects`, {
      method: "POST",
      headers: getHeaders(token),
      body: JSON.stringify({ name }),
    });
    return handle(resp);
  },
  async deleteProject(projectName, token = null) {
    const API_BASE = getApiBase();
    const resp = await fetch(
      `${API_BASE}/api/projects/${encodeURIComponent(projectName)}`,
      {
        method: "DELETE",
        headers: getHeaders(token),
      }
    );
    return handle(resp);
  },
  // Files
  async getTree(projectName, token = null) {
    const API_BASE = getApiBase();
    const resp = await fetch(
      `${API_BASE}/api/projects/${encodeURIComponent(projectName)}/files`,
      {
        headers: getHeaders(token),
      }
    );
    return handle(resp); // array of nodes
  },
  async readFile(projectName, filePath, token = null) {
    const API_BASE = getApiBase();
    const resp = await fetch(
      `${API_BASE}/api/projects/${encodeURIComponent(
        projectName
      )}/files/${filePath}`,
      {
        headers: getHeaders(token),
      }
    );
    return handle(resp); // { content, size, modified, language }
  },
  async saveFile(projectName, filePath, content, token = null) {
    const API_BASE = getApiBase();
    const resp = await fetch(
      `${API_BASE}/api/projects/${encodeURIComponent(
        projectName
      )}/files/${filePath}`,
      {
        method: "PUT",
        headers: getHeaders(token),
        body: JSON.stringify({ content }),
      }
    );
    return handle(resp);
  },
  async createEntry(projectName, filePath, type = "file", content = "", token = null) {
    const API_BASE = getApiBase();
    const resp = await fetch(
      `${API_BASE}/api/projects/${encodeURIComponent(projectName)}/files`,
      {
        method: "POST",
        headers: getHeaders(token),
        body: JSON.stringify({ filePath, type, content }),
      }
    );
    return handle(resp);
  },
  async deleteEntry(projectName, filePath, token = null) {
    const API_BASE = getApiBase();
    const resp = await fetch(
      `${API_BASE}/api/projects/${encodeURIComponent(
        projectName
      )}/files/${filePath}`,
      {
        method: "DELETE",
        headers: getHeaders(token),
      }
    );
    return handle(resp);
  },
  async renameEntry(projectName, oldPath, newName, token = null) {
    const API_BASE = getApiBase();
    const resp = await fetch(
      `${API_BASE}/api/projects/${encodeURIComponent(
        projectName
      )}/files/${oldPath}`,
      {
        method: "PATCH",
        headers: getHeaders(token),
        body: JSON.stringify({ newName }),
      }
    );
    return handle(resp);
  },

  // Run a file (HTTP)
  async runFile(
    { projectName, filePath, args = [], timeoutSec = 20, stdinText },
    token
  ) {
    const API_BASE = getApiBase();
    const resp = await fetch(`${API_BASE}/api/run`, {
      method: "POST",
      headers: getHeaders(token),
      body: JSON.stringify({
        projectName,
        filePath,
        args,
        timeoutSec,
        stdinText,
      }),
    });
    return handle(resp);
  },
  // AI chat
  async aiChat({ message, history = [], context }, token = null) {
    const API_BASE = getApiBase();
    const resp = await fetch(`${API_BASE}/api/ai/chat`, {
      method: "POST",
      headers: getHeaders(token),
      body: JSON.stringify({ message, history, context }),
    });
    return handle(resp);
  },
  // AI generate
  async aiGenerate({ prompt }, token = null) {
    const API_BASE = getApiBase();
    const resp = await fetch(`${API_BASE}/api/ai/generate`, {
      method: "POST",
      headers: getHeaders(token),
      body: JSON.stringify({ prompt }),
    });
    return handle(resp);
  },
};

export function getSocketUrl() {
  // Allow explicit override via VITE_SOCKET_URL; else fall back to API_BASE.
  try {
    if (typeof import.meta !== "undefined" && import.meta.env) {
      // In dev, connect to the current origin so Vite's proxy can forward WebSocket to backend
      if (import.meta.env.VITE_SOCKET_URL)
        return import.meta.env.VITE_SOCKET_URL;
      return DEV
        ? typeof window !== "undefined"
          ? window.location.origin
          : ""
        : getApiBase();
    }
  } catch {}
  return getApiBase();
}
