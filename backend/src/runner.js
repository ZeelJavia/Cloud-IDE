const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

async function runSteps(cwd, steps, timeoutSec, stdinText) {
  let stdout = "";
  let stderr = "";
  let lastCode = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const { cmd, args = [] } = step;
    const code = await new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd, env: process.env, shell: false });
      const timeout = timeoutSec
        ? setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {}
          }, timeoutSec * 1000)
        : null;
      child.stdout.on("data", (c) => (stdout += c.toString()));
      child.stderr.on("data", (c) => (stderr += c.toString()));
      // If this is the last step and stdinText is provided, write it
      if (i === steps.length - 1 && stdinText != null) {
        try {
          child.stdin.write(String(stdinText));
        } catch {}
        try {
          child.stdin.end();
        } catch {}
      }
      child.on("close", (code) => {
        if (timeout) clearTimeout(timeout);
        resolve(code ?? 0);
      });
      child.on("error", (err) => {
        stderr += `Spawn error (${cmd}): ${err.message}\n`;
        if (timeout) clearTimeout(timeout);
        resolve(-1);
      });
    });
    lastCode = code;
    if (code !== 0) break;
  }
  return { stdout, stderr, exitCode: lastCode };
}

function planFor(filePath, isWin, forcedOutName) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath, ext);
  const steps = [];
  const runBinary = (outName) => ({
    // Execute within the provided cwd; use relative path
    cmd: isWin ? `.\\${outName}` : `./${outName}`,
    args: [],
  });

  switch (ext) {
    case ".js":
    case ".jsx":
      steps.push({ cmd: "node", args: [filePath] });
      break;
    case ".ts":
    case ".tsx":
      // Requires ts-node; otherwise user should compile separately
      steps.push({ cmd: "npx", args: ["ts-node", filePath] });
      break;
    case ".py":
      steps.push({ cmd: "python", args: [filePath] });
      break;
    case ".java":
      steps.push({ cmd: "javac", args: [filePath] });
      steps.push({ cmd: "java", args: [base] });
      break;
    case ".c": {
      const out = forcedOutName || (isWin ? `${base}.exe` : base);
      steps.push({ cmd: "gcc", args: [filePath, "-O2", "-o", out] });
      steps.push(runBinary(out));
      return { steps, outName: out };
    }
    case ".cpp": {
      const out = forcedOutName || (isWin ? `${base}.exe` : base);
      steps.push({
        cmd: "g++",
        args: [filePath, "-std=c++17", "-O2", "-o", out],
      });
      steps.push(runBinary(out));
      return { steps, outName: out };
    }
    case ".go":
      steps.push({ cmd: "go", args: ["run", filePath] });
      break;
    case ".rs": {
      const out = forcedOutName || (isWin ? `${base}.exe` : base);
      steps.push({ cmd: "rustc", args: [filePath, "-O", "-o", out] });
      steps.push(runBinary(out));
      return { steps, outName: out };
    }
    case ".php":
      steps.push({ cmd: "php", args: [filePath] });
      break;
    case ".rb":
      steps.push({ cmd: "ruby", args: [filePath] });
      break;
    case ".swift":
      steps.push({ cmd: "swift", args: [filePath] });
      break;
    case ".kt":
      steps.push({
        cmd: "kotlinc",
        args: [filePath, "-include-runtime", "-d", "app.jar"],
      });
      steps.push({ cmd: "java", args: ["-jar", "app.jar"] });
      break;
    case ".scala":
      steps.push({ cmd: "scala", args: [filePath] });
      break;
    case ".sh":
      steps.push({ cmd: "bash", args: [filePath] });
      break;
    case ".ps1":
      steps.push({
        cmd: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filePath],
      });
      break;
    default:
      return {
        error: `Files with extension "${ext}" are not directly executable.`,
      };
  }
  return { steps };
}

/**
 * Execute a project file based on its extension.
 * @param {string} projectDir absolute path to the project directory
 * @param {string} relFile relative file path within the project
 * @param {Array<string>} args optional args to pass to the last step
 * @param {number} timeoutSec optional timeout in seconds
 */
async function runFile(
  projectDir,
  relFile,
  args = [],
  timeoutSec = 20,
  stdinText = undefined
) {
  const isWin = process.platform === "win32";
  const abs = path.resolve(projectDir, relFile);
  if (!fileExists(abs)) {
    return { stdout: "", stderr: `File not found: ${relFile}`, exitCode: -1 };
  }
  const relForCmd = relFile.replace(/\\/g, "/");
  // For compiled languages, prefer a unique output filename to avoid 'Permission denied' on locked .exe files
  const ext = path.extname(relForCmd).toLowerCase();
  let forcedOut = undefined;
  if ([".c", ".cpp", ".rs"].includes(ext)) {
    const base = path.basename(relForCmd, ext);
    const stamp = Date.now().toString(36);
    forcedOut = isWin ? `${base}-${stamp}.exe` : `${base}-${stamp}`;
  }
  let plan = planFor(relForCmd, isWin, forcedOut);
  if (plan.error) {
    return { stdout: "", stderr: plan.error, exitCode: -1 };
  }
  // If this language produces an output binary/jar, try removing old file to avoid permission issues on Windows
  if (plan.outName) {
    const outAbs = path.join(projectDir, plan.outName);
    try {
      if (fs.existsSync(outAbs)) {
        fs.unlinkSync(outAbs);
      }
    } catch (err) {
      // If deletion fails (possibly locked), keep using a unique name already set
      // No further action; we'll run with whatever plan has.
    }
  }
  // Append args to the last step if provided
  if (args && args.length && plan.steps.length) {
    plan.steps[plan.steps.length - 1].args.push(...args);
  }
  const result = await runSteps(projectDir, plan.steps, timeoutSec, stdinText);
  // Best-effort cleanup of generated binary
  if (plan.outName) {
    const outAbs = path.join(projectDir, plan.outName);
    try {
      if (fs.existsSync(outAbs)) fs.unlinkSync(outAbs);
    } catch {}
  }
  return result;
}

module.exports = { runFile };
