import { keepStart, WRITE_FILE_SCRIPT } from "./sandbox.js";

const ROOT = "/workspace";
const SUPPORTED = ["ls", "cat", "echo", "grep", "wc", "head", "tail", "mkdir", "rm", "touch", "sleep", "pwd", "cd", "id"];
const NEEDS_DOCKER = `not available in the simulated sandbox. This command needs the real Docker sandbox, which runs with the local model in the installed app. The simulation only knows ${SUPPORTED.join(", ")}.`;
const encoder = new TextEncoder();

class Exit {
  constructor(code, stdout = "", stderr = "") {
    Object.assign(this, { code, stdout, stderr });
  }
}

export function createSimulatedWorkspace({ now = () => new Date() } = {}) {
  const files = new Map();
  const dirs = new Set([ROOT]);

  function seed(seedFiles) {
    files.clear();
    dirs.clear();
    dirs.add(ROOT);
    for (const [name, text] of Object.entries(seedFiles)) files.set(`${ROOT}/${name}`, { text, mtime: now() });
  }

  function resolve(cwd, path) {
    const parts = (String(path).startsWith("/") ? [] : cwd.split("/").filter(Boolean)).concat(String(path).split("/"));
    const out = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    return `/${out.join("/")}`;
  }

  const inWorkspace = (abs) => abs === ROOT || abs.startsWith(`${ROOT}/`);
  const parentOf = (abs) => abs.slice(0, abs.lastIndexOf("/")) || "/";
  const isDir = (abs) => dirs.has(abs);
  const children = (abs) =>
    [...new Set([...files.keys(), ...dirs].filter((p) => p !== abs && parentOf(p) === abs).map((p) => p.slice(abs.length + 1)))].sort();

  function writeFile(abs, text, append = false) {
    if (!inWorkspace(abs)) throw new Exit(1, "", `can't create '${abs}': Read-only file system\n`);
    if (!isDir(parentOf(abs))) throw new Exit(1, "", `can't create '${abs}': No such file or directory\n`);
    if (isDir(abs)) throw new Exit(1, "", `can't create '${abs}': Is a directory\n`);
    const before = append ? (files.get(abs)?.text ?? "") : "";
    files.set(abs, { text: before + text, mtime: now() });
  }

  function readFile(abs, tool, shown) {
    if (isDir(abs)) throw new Exit(1, "", `${tool}: read error: Is a directory\n`);
    const file = files.get(abs);
    if (!file) throw new Exit(1, "", `${tool}: can't open '${shown}': No such file or directory\n`);
    return file.text;
  }

  function lsLine(abs, name) {
    const dir = isDir(abs);
    const size = dir ? 4096 : encoder.encode(files.get(abs).text).length;
    const mtime = dir ? now() : files.get(abs).mtime;
    const date = `${mtime.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${String(mtime.getUTCDate()).padStart(2)} ${String(mtime.getUTCHours()).padStart(2, "0")}:${String(mtime.getUTCMinutes()).padStart(2, "0")}`;
    return `${dir ? "drwxr-xr-x" : "-rw-r--r--"}    1 1000     1000     ${String(size).padStart(9)} ${date} ${name}`;
  }

  const commands = {
    pwd: (args, io) => new Exit(0, `${io.cwd}\n`),
    id: () => new Exit(0, "uid=1000 gid=1000 groups=1000\n"),
    cd(args, io) {
      const target = resolve(io.cwd, args[0] ?? ROOT);
      if (!isDir(target)) return new Exit(2, "", `sh: cd: can't cd to ${args[0]}: No such file or directory\n`);
      io.cwd = target;
      return new Exit(0);
    },
    echo(args) {
      const noNewline = args[0] === "-n";
      return new Exit(0, `${(noNewline ? args.slice(1) : args).join(" ")}${noNewline ? "" : "\n"}`);
    },
    ls(args, io) {
      const { flags, rest } = splitFlags(args);
      const long = flags.includes("l");
      const all = flags.includes("a");
      const targets = rest.length ? rest : ["."];
      let stdout = "";
      let stderr = "";
      for (const target of targets) {
        const abs = resolve(io.cwd, target);
        if (!isDir(abs) && !files.has(abs)) {
          stderr += `ls: ${target}: No such file or directory\n`;
          continue;
        }
        if (!isDir(abs)) {
          stdout += `${long ? lsLine(abs, target) : target}\n`;
          continue;
        }
        const names = children(abs).filter((name) => all || !name.startsWith("."));
        if (long) {
          stdout += `total ${names.length * 4}\n`;
          if (all) stdout += `${lsLine(abs, ".")}\n${lsLine(parentOf(abs) === "/" ? abs : parentOf(abs), "..")}\n`;
          stdout += names.map((name) => `${lsLine(`${abs}/${name}`, name)}\n`).join("");
        } else stdout += names.map((name) => `${name}\n`).join("");
      }
      return new Exit(stderr ? 1 : 0, stdout, stderr);
    },
    cat(args, io) {
      const names = args.filter((arg) => arg !== "--");
      if (!names.length) return new Exit(0, io.stdin);
      let stdout = "";
      for (const name of names) stdout += readFile(resolve(io.cwd, name), "cat", name);
      return new Exit(0, stdout);
    },
    head: (args, io) => slice("head", args, io, (lines, n) => lines.slice(0, n)),
    tail: (args, io) => slice("tail", args, io, (lines, n) => lines.slice(Math.max(0, lines.length - n))),
    wc(args, io) {
      const { flags, rest } = splitFlags(args);
      const count = (text) => {
        const counts = { l: (text.match(/\n/g) ?? []).length, w: text.split(/\s+/).filter(Boolean).length, c: encoder.encode(text).length };
        const picked = flags.length ? flags.filter((f) => f in counts) : ["l", "w", "c"];
        return picked.map((f) => counts[f]);
      };
      if (!rest.length) return new Exit(0, `${count(io.stdin).join(" ")}\n`);
      const out = rest.map((name) => `${count(readFile(resolve(io.cwd, name), "wc", name)).join(" ")} ${name}\n`);
      return new Exit(0, out.join(""));
    },
    grep(args, io) {
      const { flags, rest } = splitFlags(args);
      const [pattern, ...names] = rest;
      if (pattern === undefined) return new Exit(2, "", "grep: no pattern given\n");
      const regex = grepRegex(pattern, flags);
      const sources = names.length ? names.map((name) => [name, readFile(resolve(io.cwd, name), "grep", name)]) : [["", io.stdin]];
      let stdout = "";
      let matched = 0;
      for (const [name, text] of sources) {
        const prefix = sources.length > 1 ? `${name}:` : "";
        const lines = text.split("\n");
        if (lines.at(-1) === "") lines.pop();
        let fileCount = 0;
        lines.forEach((line, index) => {
          regex.lastIndex = 0;
          const hit = regex.test(line) !== flags.includes("v");
          if (!hit) return;
          fileCount += 1;
          if (flags.includes("c")) return;
          const lineNo = flags.includes("n") ? `${index + 1}:` : "";
          if (flags.includes("o") && !flags.includes("v")) {
            for (const match of line.matchAll(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`))) stdout += `${prefix}${lineNo}${match[0]}\n`;
          } else stdout += `${prefix}${lineNo}${line}\n`;
        });
        if (flags.includes("c")) stdout += `${prefix}${fileCount}\n`;
        matched += fileCount;
      }
      return new Exit(matched ? 0 : 1, stdout);
    },
    mkdir(args, io) {
      const { flags, rest } = splitFlags(args);
      for (const name of rest) {
        const abs = resolve(io.cwd, name);
        if (!inWorkspace(abs)) return new Exit(1, "", `mkdir: can't create directory '${name}': Read-only file system\n`);
        if (flags.includes("p")) {
          for (let at = abs; at !== ROOT && at !== "/"; at = parentOf(at)) dirs.add(at);
        } else if (!isDir(parentOf(abs))) return new Exit(1, "", `mkdir: can't create directory '${name}': No such file or directory\n`);
        else dirs.add(abs);
      }
      return new Exit(0);
    },
    touch(args, io) {
      for (const name of args) {
        const abs = resolve(io.cwd, name);
        if (!files.has(abs)) writeFile(abs, "");
      }
      return new Exit(0);
    },
    rm(args, io) {
      const { flags, rest } = splitFlags(args);
      const recursive = flags.includes("r") || flags.includes("R");
      let stderr = "";
      for (const name of rest) {
        const abs = resolve(io.cwd, name);
        if (abs === ROOT || !inWorkspace(abs)) {
          stderr += `rm: can't remove '${name}': Resource busy\n`;
        } else if (isDir(abs)) {
          if (!recursive) stderr += `rm: '${name}' is a directory\n`;
          else {
            for (const path of [...files.keys()]) if (path.startsWith(`${abs}/`)) files.delete(path);
            for (const path of [...dirs]) if (path === abs || path.startsWith(`${abs}/`)) dirs.delete(path);
          }
        } else if (files.has(abs)) files.delete(abs);
        else if (!flags.includes("f")) stderr += `rm: can't remove '${name}': No such file or directory\n`;
      }
      return new Exit(stderr ? 1 : 0, "", stderr);
    },
    async sleep(args, io) {
      const seconds = Number(args[0]);
      if (!Number.isFinite(seconds) || seconds < 0) return new Exit(1, "", `sleep: invalid number '${args[0]}'\n`);
      await io.wait(seconds * 1000);
      return new Exit(0);
    },
  };

  function slice(tool, args, io, pick) {
    let n = 10;
    const names = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "-n") n = Number(args[++i]);
      else if (/^-\d+$/.test(args[i])) n = Number(args[i].slice(1));
      else names.push(args[i]);
    }
    const text = names.length ? readFile(resolve(io.cwd, names[0]), tool, names[0]) : io.stdin;
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    const kept = pick(lines, n);
    return new Exit(0, kept.length ? `${kept.join("\n")}\n` : "");
  }

  async function runOne(argv, io) {
    const [name, ...args] = argv;
    const command = commands[name];
    if (!command) return new Exit(127, "", `sh: ${name}: ${NEEDS_DOCKER}\n`);
    try {
      return await command(args, io);
    } catch (error) {
      if (error instanceof Exit) return error;
      throw error;
    }
  }

  async function runScript(script, params, io) {
    let last = new Exit(0);
    let stdout = "";
    let stderr = "";
    const scriptInput = io.stdin;
    for (const { pipeline, op } of parseScript(script, params)) {
      if ((op === "&&" && last.code !== 0) || (op === "||" && last.code === 0)) continue;
      let input = scriptInput;
      for (const [index, stage] of pipeline.entries()) {
        io.stdin = input;
        last = await runOne(stage.argv, io);
        if (stage.errors === "merge") last = new Exit(last.code, last.stdout + last.stderr, "");
        if (stage.errors !== "drop") stderr += last.stderr;
        if (index < pipeline.length - 1) input = last.stdout;
      }
      const end = pipeline.at(-1);
      if (end.redirect?.path === "/dev/null") {
        last = new Exit(last.code, "", "");
      } else if (end.redirect) {
        try {
          writeFile(resolve(io.cwd, end.redirect.path), last.stdout, end.redirect.append);
          last = new Exit(last.code, "", "");
        } catch (error) {
          if (!(error instanceof Exit)) throw error;
          last = new Exit(1, "", `sh: ${error.stderr}`);
          stderr += last.stderr;
        }
      } else stdout += last.stdout;
      if (io.timedOut()) break;
    }
    return new Exit(last.code, stdout, stderr);
  }

  async function run(request) {
    const startedAt = performance.now();
    let timedOut = false;
    let timer = null;
    let wake = null;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        wake?.();
        resolve();
      }, request.timeoutMs);
    });
    const io = {
      cwd: ROOT,
      stdin: request.stdin ?? "",
      timedOut: () => timedOut,
      wait: (ms) =>
        Promise.race([
          new Promise((resolve) => {
            wake = resolve;
            setTimeout(resolve, ms);
          }),
          deadline,
        ]),
    };
    let result;
    try {
      const [first, second, script, , ...params] = request.command;
      if (first === "sh" && second === "-c" && script === WRITE_FILE_SCRIPT && params.length) {
        const abs = resolve(ROOT, params[0]);
        for (let at = parentOf(abs); inWorkspace(at) && at !== ROOT; at = parentOf(at)) dirs.add(at);
        writeFile(abs, request.stdin ?? "");
        result = new Exit(0);
      } else if (first === "sh" && second === "-c") {
        result = await runScript(String(script ?? ""), request.command.slice(3), io);
      } else {
        result = await runOne(request.command, io);
      }
    } catch (error) {
      result = error instanceof Exit ? error : new Exit(2, "", `sh: ${error.message}\n`);
    } finally {
      clearTimeout(timer);
    }
    const stdout = keepStart(request.maxOutputChars);
    const stderr = keepStart(request.maxOutputChars);
    stdout.add(result.stdout);
    stderr.add(result.stderr);
    return {
      argv: request.command,
      ...(request.stdin === undefined ? {} : { stdin: request.stdin }),
      stdout: stdout.text(),
      stderr: stderr.text(),
      exitCode: timedOut ? null : result.code,
      timedOut,
      elapsedMs: performance.now() - startedAt,
      simulated: true,
    };
  }

  function read(name) {
    const file = files.get(`${ROOT}/${name}`);
    if (!file) throw Object.assign(new Error(`${name} isn't in the workspace.`), { code: "ENOENT" });
    return file.text;
  }

  function write(name, text) {
    files.set(`${ROOT}/${name}`, { text: String(text), mtime: now() });
  }

  return { seed, run, read, write, list: () => [...files.keys()].map((path) => path.slice(ROOT.length + 1)).sort() };
}

function splitFlags(args) {
  const flags = [];
  const rest = [];
  let done = false;
  for (const arg of args) {
    if (!done && arg === "--") done = true;
    else if (!done && /^-[A-Za-z]+$/.test(arg)) flags.push(...arg.slice(1));
    else if (!done && /^--[a-z-]+$/.test(arg)) flags.push(LONG_FLAGS[arg] ?? arg);
    else rest.push(arg);
  }
  return { flags, rest };
}

const LONG_FLAGS = {
  "--ignore-case": "i",
  "--only-matching": "o",
  "--word-regexp": "w",
  "--count": "c",
  "--lines": "l",
  "--recursive": "r",
  "--force": "f",
  "--all": "a",
  "--parents": "p",
};

function grepRegex(pattern, flags) {
  const escaped = flags.includes("F") ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern.replace(/\\([(){}|+?])/g, "$1");
  const body = flags.includes("w") ? `(?<![A-Za-z0-9_])(?:${escaped})(?![A-Za-z0-9_])` : escaped;
  try {
    return new RegExp(body, flags.includes("i") ? "i" : "");
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags.includes("i") ? "i" : "");
  }
}

export function tokenize(script, params = []) {
  const expand = (text) => text.replace(/\$(\d)/g, (_, n) => params[Number(n)] ?? "");
  const tokens = [];
  let current = null;
  const push = () => {
    if (current !== null) tokens.push({ word: current });
    current = null;
  };
  for (let i = 0; i < script.length; i += 1) {
    const char = script[i];
    if (char === "'") {
      const end = script.indexOf("'", i + 1);
      if (end < 0) throw new Error("unterminated quoted string");
      current = (current ?? "") + script.slice(i + 1, end);
      i = end;
    } else if (char === '"') {
      let text = "";
      for (i += 1; i < script.length && script[i] !== '"'; i += 1) text += script[i] === "\\" && /["\\$`]/.test(script[i + 1] ?? "") ? script[++i] : script[i];
      if (i >= script.length) throw new Error("unterminated quoted string");
      current = (current ?? "") + expand(text);
    } else if (char === "\\" && i + 1 < script.length) {
      current = (current ?? "") + script[++i];
    } else if (/\s/.test(char)) {
      push();
    } else if ("|&;>".includes(char)) {
      push();
      const two = script.slice(i, i + 2);
      if (["&&", "||", ">>"].includes(two)) {
        tokens.push({ op: two });
        i += 1;
      } else if (char === "&") throw new Error("running commands in the background isn't simulated");
      else tokens.push({ op: char });
    } else if (current === null && script.startsWith("2>&1", i)) {
      tokens.push({ op: "2>&1" });
      i += 3;
    } else if (current === null && /^2>\s*\/dev\/null/.test(script.slice(i))) {
      tokens.push({ op: "2>null" });
      i += script.slice(i).match(/^2>\s*\/dev\/null/)[0].length - 1;
    } else if (char === "$" && /\d/.test(script[i + 1] ?? "")) {
      current = (current ?? "") + expand(script.slice(i, i + 2));
      i += 1;
    } else {
      current = (current ?? "") + char;
    }
  }
  push();
  return tokens;
}

export function parseScript(script, params = []) {
  const lists = [];
  let pipeline = [];
  let stage = { argv: [] };
  let op = null;
  const tokens = tokenize(script, params);
  const endStage = () => {
    if (!stage.argv.length) throw new Error("syntax error");
    pipeline.push(stage);
    stage = { argv: [] };
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.word !== undefined) stage.argv.push(token.word);
    else if (token.op === "|") endStage();
    else if (token.op === "2>&1") stage.errors = "merge";
    else if (token.op === "2>null") stage.errors = "drop";
    else if (token.op === ">" || token.op === ">>") {
      const target = tokens[++i];
      if (target?.word === undefined) throw new Error("syntax error near redirect");
      stage.redirect = { path: target.word, append: token.op === ">>" };
    } else {
      endStage();
      lists.push({ pipeline, op });
      pipeline = [];
      op = token.op === ";" ? null : token.op;
    }
  }
  if (stage.argv.length) endStage();
  if (pipeline.length) lists.push({ pipeline, op });
  return lists;
}
