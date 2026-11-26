export const SANDBOX_IMAGE = "python:3.13-alpine";
export const SANDBOX_IMAGE_SIZE = "about 74 MB";
export const SANDBOX_LIMITS = { cpus: "1", memory: "256m", processes: 64, timeoutMs: 10_000, maxOutputChars: 8_000 };
export const WORKSPACE_FOLDER = "harness-course-workspace";
export const WORKSPACE_LABEL = `~/${WORKSPACE_FOLDER}`;
export const WRITE_FILE_SCRIPT = 'mkdir -p "$(dirname "$1")" && cat > "$1"';

const MAX_COMMAND_CHARS = 100_000;
const MAX_STDIN_CHARS = 1_000_000;
const MAX_WORKSPACE_READ_BYTES = 1_000_000;
const CHECK_TIMEOUT_MS = 15_000;
const KILL_GRACE_MS = 5_000;
const CONTAINER_NAME = /^harness-sandbox-[0-9a-f]{8}$/;
const WORKSPACE_FILE_NAME = /^(?!\.\.?$)[A-Za-z0-9._-]{1,128}$/;
const DOCKER_SEARCH_PATH = "/usr/local/bin:/opt/homebrew/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin";

export const FIND_DOCKER_COMMAND = `PATH="$PATH:${DOCKER_SEARCH_PATH}" command -v docker`;
export const DOCKER_INFO_ARGS = ["info", "--format", "{{.ServerVersion}}"];
export const DOCKER_IMAGE_ARGS = ["image", "inspect", "--format", "{{.Id}}", SANDBOX_IMAGE];

// Every lock on the container, in one place. The page builds this; harness code only picks the command inside.
export function dockerArgs(containerName, workspace, command, withStdin = false) {
  return [
    "run",
    "--rm",
    "--name", containerName,
    ...(withStdin ? ["--interactive"] : []),
    "--network", "none",
    "--user", "1000:1000",
    "--read-only",
    "--tmpfs", "/tmp:rw,size=16m",
    "--env", "HOME=/tmp",
    "--volume", `${workspace}:/workspace`,
    "--workdir", "/workspace",
    "--cpus", SANDBOX_LIMITS.cpus,
    "--memory", SANDBOX_LIMITS.memory,
    "--memory-swap", SANDBOX_LIMITS.memory,
    "--pids-limit", String(SANDBOX_LIMITS.processes),
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    SANDBOX_IMAGE,
    ...command,
  ];
}

export function newContainerName() {
  return `harness-sandbox-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export function isSandboxRunArgs(args, workspace) {
  if (!Array.isArray(args) || args[0] !== "run" || !CONTAINER_NAME.test(String(args[3]))) return false;
  const withStdin = args[4] === "--interactive";
  const locked = dockerArgs(args[3], workspace, [], withStdin);
  return args.length > locked.length && locked.every((arg, index) => args[index] === arg) && args.every((arg) => typeof arg === "string");
}

export function isSandboxKillArgs(args) {
  return Array.isArray(args) && args.length === 2 && args[0] === "kill" && CONTAINER_NAME.test(String(args[1]));
}

// The worker's request is untrusted: harness code may send anything. Only the command inside the container is its to choose.
export function sandboxRequest(raw) {
  const command = raw?.command;
  if (!Array.isArray(command) || command.length === 0 || !command.every((part) => typeof part === "string")) {
    throw new TypeError("The sandbox needs a command as a non-empty list of strings, such as [\"ls\", \"-la\"].");
  }
  if (command.join(" ").length > MAX_COMMAND_CHARS || command.some((part) => part.includes("\0"))) {
    throw new TypeError("That command is too long for the sandbox.");
  }
  const stdin = raw.stdin === undefined || raw.stdin === null ? undefined : String(raw.stdin);
  if (stdin !== undefined && stdin.length > MAX_STDIN_CHARS) throw new TypeError("The input for that command is too long for the sandbox.");
  return {
    command: [...command],
    stdin,
    timeoutMs: clamp(raw.timeoutMs, 1, SANDBOX_LIMITS.timeoutMs),
    maxOutputChars: clamp(raw.maxOutputChars, 0, SANDBOX_LIMITS.maxOutputChars),
  };
}

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(Math.round(number), min), max) : max;
}

export function keepStart(limit) {
  let kept = "";
  let cut = 0;
  return {
    add(chunk) {
      const text = String(chunk);
      const room = Math.max(0, limit - kept.length);
      kept += text.slice(0, room);
      cut += Math.max(0, text.length - room);
    },
    text: () => (cut === 0 ? kept : `${kept}\n[... cut ${cut} more characters]`),
  };
}

export function runProcess(desktop, file, args, { stdin, timeoutMs, maxOutputChars = SANDBOX_LIMITS.maxOutputChars, onTimeout } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const stdout = keepStart(maxOutputChars);
    const stderr = keepStart(maxOutputChars);
    let timedOut = false;
    let settled = false;
    let fallback = null;
    const child = desktop.childProcess.spawn(file, args);
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(fallback);
      resolve({ stdout: stdout.text(), stderr: stderr.text(), exitCode, timedOut, elapsedMs: performance.now() - startedAt });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      Promise.resolve(onTimeout ? onTimeout() : child.kill("SIGKILL")).catch(() => {});
      fallback = setTimeout(() => {
        child.kill("SIGKILL").catch(() => {});
        finish(null);
      }, KILL_GRACE_MS);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.add(chunk));
    child.stderr.on("data", (chunk) => stderr.add(chunk));
    child.on("close", (code) => finish(code));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(fallback);
      reject(error);
    });
    const input = stdin === undefined ? Promise.resolve() : child.stdin.write(stdin);
    Promise.resolve(input)
      .then(() => child.stdin.end())
      .catch(() => {});
  });
}

export async function runDocker(desktop, { docker, workspace }, request) {
  const name = newContainerName();
  const args = dockerArgs(name, workspace, request.command, request.stdin !== undefined);
  const result = await runProcess(desktop, docker, args, {
    stdin: request.stdin,
    timeoutMs: request.timeoutMs,
    maxOutputChars: request.maxOutputChars,
    onTimeout: () => runProcess(desktop, docker, ["kill", name], { timeoutMs: CHECK_TIMEOUT_MS }),
  });
  return {
    argv: ["docker", ...args],
    ...(request.stdin === undefined ? {} : { stdin: request.stdin }),
    ...result,
  };
}

export async function findDocker(desktop) {
  const found = await desktop.childProcess.exec(FIND_DOCKER_COMMAND, { timeout: 5_000 }).catch(() => ({ code: 1, stdout: "" }));
  const path = String(found.stdout ?? "").trim().split("\n")[0];
  return found.code === 0 && path.startsWith("/") ? path : null;
}

export async function checkDocker(desktop) {
  const docker = await findDocker(desktop);
  if (!docker) return { state: "missing", docker: null, version: "" };
  const quiet = (args) => runProcess(desktop, docker, args, { timeoutMs: CHECK_TIMEOUT_MS, maxOutputChars: 2_000 }).catch(() => ({ exitCode: 1, stdout: "" }));
  const info = await quiet(DOCKER_INFO_ARGS);
  if (info.exitCode !== 0 || info.timedOut) return { state: "stopped", docker, version: "" };
  const version = info.stdout.trim();
  const image = await quiet(DOCKER_IMAGE_ARGS);
  return { state: image.exitCode === 0 ? "ready" : "no-image", docker, version };
}

export function dockerSetupSteps(check, platform = "darwin") {
  const mac = platform === "darwin";
  const steps = [];
  if (check.state === "missing") {
    steps.push({
      problem: "Docker isn't installed. The sandbox is a Docker container, so the agent's commands can't touch the rest of your computer.",
      command: mac ? "brew install --cask docker-desktop" : undefined,
      hint: mac ? "No Homebrew? Download Docker Desktop from docker.com instead." : "Install Docker Engine, following docs.docker.com/engine/install.",
    });
  }
  if (check.state === "missing" || check.state === "stopped") {
    steps.push({
      problem: check.state === "stopped" ? "Docker is installed but not running." : "Then start Docker.",
      command: mac ? "open -a Docker" : "sudo systemctl start docker",
      hint: mac ? "Wait until Docker says it is running." : undefined,
    });
  }
  if (check.state !== "ready") {
    steps.push({ problem: `The sandbox image ${SANDBOX_IMAGE} isn't downloaded yet (${SANDBOX_IMAGE_SIZE}).`, command: `docker pull ${SANDBOX_IMAGE}` });
  }
  return steps;
}

export async function workspacePath(desktop) {
  const home = String(await desktop.os.homedir()).replace(/\/+$/, "");
  return `${home}/${WORKSPACE_FOLDER}`;
}

export async function ensureWorkspace(desktop, workspace, seed) {
  if (await desktop.fs.exists(workspace)) {
    const stats = await desktop.fs.lstat(workspace);
    if (stats.isSymbolicLink || !stats.isDirectory) throw new Error(`${WORKSPACE_LABEL} isn't a folder, so the sandbox can't use it. Move it away, then try again.`);
    return false;
  }
  await desktop.fs.mkdir(workspace, { recursive: true });
  for (const [name, text] of Object.entries(seed)) await desktop.fs.writeFile(`${workspace}/${name}`, text, "utf8");
  return true;
}

export async function resetWorkspace(desktop, workspace, seed) {
  if (await desktop.fs.exists(workspace)) await desktop.shell.trashItem(workspace);
  await ensureWorkspace(desktop, workspace, seed);
}

export function workspaceFileName(name) {
  const value = String(name ?? "");
  if (!WORKSPACE_FILE_NAME.test(value)) throw new TypeError(`Only a file at the top of the workspace can be read this way, not "${value}".`);
  return value;
}

// The agent can write anything in the workspace, including a link to a file elsewhere, so check what is there before reading.
export async function readWorkspaceFile(desktop, workspace, name) {
  const path = `${workspace}/${workspaceFileName(name)}`;
  let stats;
  try {
    stats = await desktop.fs.lstat(path);
  } catch (error) {
    throw Object.assign(new Error(`${name} isn't in the workspace.`), { code: String(error?.message ?? "").startsWith("ENOENT") ? "ENOENT" : "EIO" });
  }
  if (stats.isSymbolicLink) throw Object.assign(new Error(`${name} in the workspace is a link, so it isn't read.`), { code: "ELINK" });
  if (!stats.isFile) throw Object.assign(new Error(`${name} in the workspace is not a regular file.`), { code: "ENOTFILE" });
  if (stats.size > MAX_WORKSPACE_READ_BYTES) throw Object.assign(new Error(`${name} in the workspace is too big to read.`), { code: "EFBIG" });
  return desktop.fs.readFile(path, "utf8");
}

export async function writeWorkspaceFile(desktop, workspace, name, text) {
  const path = `${workspace}/${workspaceFileName(name)}`;
  if (await desktop.fs.exists(path)) {
    const stats = await desktop.fs.lstat(path);
    if (stats.isSymbolicLink || !stats.isFile) throw new Error(`${name} in the workspace isn't a regular file, so it wasn't changed.`);
  }
  await desktop.fs.writeFile(path, String(text), "utf8");
}
