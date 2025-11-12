const { spawn } = require("child_process");

// Input limits from config
const config = require("../config");

function clampString(s, max) {
  s = String(s == null ? "" : s);
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max));
}

function sanitizeArgs(args) {
  const a = Array.isArray(args) ? args.slice(0, config.ARG_MAX_COUNT) : [];
  return a.map((x) => clampString(x, config.ARG_MAX_LEN));
}

function sanitizeEnvVars(envVars) {
  const out = {};
  const entries = Object.entries(envVars || {}).slice(0, config.ENV_MAX_COUNT);
  for (const [k, v] of entries) out[k] = clampString(v, config.ENV_VAL_MAX_LEN);
  return out;
}

// Utility: check a tool exists and get output
async function checkTool(cmd, args = ["--version"]) {
  return await new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { shell: false });
      let out = "";
      let err = "";
      p.stdout.on("data", (c) => (out += c.toString()));
      p.stderr.on("data", (c) => (err += c.toString()));
      p.on("close", (code) => {
        resolve({
          ok: code === 0,
          code,
          stdout: out.trim(),
          stderr: err.trim(),
        });
      });
      p.on("error", (e) => {
        resolve({ ok: false, code: -1, stdout: "", stderr: e.message });
      });
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: "", stderr: e.message });
    }
  });
}

// Lightweight spawn helper
function spawnWait(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { shell: false, ...opts });
      let out = "";
      let err = "";
      p.stdout?.on?.("data", (c) => (out += c.toString()));
      p.stderr?.on?.("data", (c) => (err += c.toString()));
      p.on("close", (code) => resolve({ code, stdout: out, stderr: err }));
      p.on("error", (e) =>
        resolve({ code: -1, stdout: "", stderr: e.message })
      );
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: e.message });
    }
  });
}

function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  clampString,
  sanitizeArgs,
  sanitizeEnvVars,
  checkTool,
  spawnWait,
  genId,
};
