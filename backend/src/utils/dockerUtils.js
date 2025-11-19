const { spawn } = require("child_process");
const { spawnWait } = require("./validationUtils");

// Docker warm container reuse
const reusePool = new Map(); // key -> { containerName, image, projectDir, limits, lastUsed }
const config = require("../config");

function poolKey(image, projectDir, limits) {
  const lim = limits || {};
  return `${image}|${projectDir}|cpus=${lim.cpus}|mem=${lim.memory}|pids=${lim.pids}`;
}

async function ensureWarmContainer(image, projectDir, limits) {
  const key = poolKey(image, projectDir, limits);
  const existing = reusePool.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.containerName;
  }
  const containerName = `ide-reuse-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const argsCreate = [
    "run",
    "-dit",
    "--name",
    containerName,
    "--cpus",
    String(limits?.cpus || "1.0"),
    "--memory",
    String(limits?.memory || "512m"),
    "--pids-limit",
    String(limits?.pids || 256),
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "-v",
    `${projectDir}:/workspace`,
    "-w",
    "/workspace",
    image,
    "sh",
    "-lc",
    "sleep infinity",
  ];
  const created = await spawnWait("docker", argsCreate);
  if (created.code !== 0) {
    throw new Error(
      `Failed to create warm container: ${created.stderr || created.stdout}`
    );
  }
  reusePool.set(key, {
    containerName,
    image,
    projectDir,
    limits: { ...limits },
    lastUsed: Date.now(),
  });
  console.log(`🔥 Warm container started: ${containerName} (${image})`);
  return containerName;
}

async function cleanupWarmContainers() {
  if (!config.CONTAINER_TTL_SEC || config.CONTAINER_TTL_SEC <= 0) return;
  const now = Date.now();
  for (const [key, rec] of Array.from(reusePool.entries())) {
    if (now - rec.lastUsed > config.CONTAINER_TTL_SEC * 1000) {
      try {
        await spawnWait("docker", ["rm", "-f", rec.containerName]);
        console.log(`🧹 Removed stale warm container: ${rec.containerName}`);
      } catch {}
      reusePool.delete(key);
    }
  }
}

// Background Docker image pre-pull (optional)
async function prePullDockerImages() {
  try {
    const images = config.DOCKER_IMAGES.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!images.length) return;

    const hasDocker = await spawnWait("docker", ["--version"]);
    if (hasDocker.code !== 0) {
      console.warn("⚠️ Docker not detected; skipping image pre-pull");
      return;
    }

    for (const image of images) {
      const inspect = await spawnWait("docker", ["image", "inspect", image]);
      if (inspect.code === 0) {
        console.log(`🐳 Docker image present: ${image}`);
        continue;
      }
      console.log(`🐳 Pulling docker image: ${image} ...`);
      const pull = await spawnWait("docker", ["pull", image]);
      if (pull.code === 0) {
        console.log(`✅ Pulled: ${image}`);
      } else {
        console.warn(
          `⚠️ Failed to pull ${image}: ${pull.stderr || pull.stdout}`
        );
      }
    }
  } catch (e) {
    console.warn("⚠️ prePullDockerImages error:", e.message);
  }
}

const dockerImageExists = async (imageName) => {
  return await new Promise((resolve) => {
    const p = spawn("docker", ["image", "inspect", imageName], {
      shell: false,
    });
    p.on("close", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
};

const dockerPullImage = async (imageName, socket, terminalId) => {
  if (socket && terminalId) {
    socket.emit("terminal-output", {
      terminalId,
      output: `Pulling docker image: ${imageName} (this may take a while on first use)\n`,
      error: false,
    });
  }

  return await new Promise((resolve) => {
    const child = spawn("docker", ["pull", imageName], { shell: false });
    let output = "";
    let error = "";

    child.stdout.on("data", (chunk) => {
      const data = chunk.toString();
      output += data;
      if (socket && terminalId) {
        socket.emit("terminal-output", { terminalId, output: data });
      }
    });

    child.stderr.on("data", (chunk) => {
      const data = chunk.toString();
      error += data;
      if (socket && terminalId) {
        socket.emit("terminal-output", {
          terminalId,
          output: data,
          error: true,
        });
      }
    });

    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(-1));
  });
};

module.exports = {
  reusePool,
  poolKey,
  ensureWarmContainer,
  cleanupWarmContainers,
  dockerImageExists,
  dockerPullImage,
};
