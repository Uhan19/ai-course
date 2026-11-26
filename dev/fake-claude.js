(() => {
  const mode = window.__FAKE_MODE__ || "fallback";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const installed = mode === "local" || mode === "local-ask" || mode === "local-nodocker";
  const noDocker = mode === "local-nodocker";

  const allText = (input) => (typeof input === "string" ? input : input.map((t) => t.content).join("\n"));
  const lastUser = (input) => (typeof input === "string" ? input : [...input].reverse().find((t) => t.role === "user")?.content ?? "");

  function scripted(input, json) {
    const text = allText(input);
    if (json && /"list_files"/.test(text)) {
      const asked = typeof input === "string" ? input : input.find((t, i) => i > 0 && t.role === "user" && !/^Result of the tool/.test(t.content))?.content ?? "";
      if (/Result of the tool/.test(lastUser(input))) return { content: "(Scripted fallback reply) Done. The tool result is in the x-ray.", tool_calls: [] };
      if (/create|write/i.test(asked)) return { content: "", tool_calls: [{ name: "write_file", arguments: { path: "shopping.txt", content: "apples\nbread\nmilk\n" } }] };
      if (/\brun\b/i.test(asked)) return { content: "", tool_calls: [{ name: "run_command", arguments: { command: "python3 hello.py" } }] };
      return { content: "", tool_calls: [{ name: "list_files", arguments: {} }] };
    }
    if (json) {
      if (!/Result of the tool/.test(text)) {
        return {
          content: "",
          tool_calls: [
            { name: "get_current_time", arguments: { timezone: "Asia/Tokyo" } },
            { name: "calculator", arguments: { expression: "(80 * 15) / 100" } },
          ],
        };
      }
      return { content: "(Scripted fallback reply) It's evening in Tokyo, and 15% of 80 is 12.", tool_calls: [] };
    }
    if (/what is my name/i.test(lastUser(input)) && /Sam/.test(text)) return "(Scripted fallback reply) Your name is Sam.";
    return `(Scripted fallback reply) You said: “${lastUser(input).slice(0, 80)}”.`;
  }

  async function sample(input, options = {}) {
    if (mode === "declined") throw { code: "not_granted", message: "The viewer declined." };
    await wait(200);
    if (options.signal?.aborted) throw { code: "cancelled", message: "cancelled" };
    const text = scripted(input, false);
    options.onText?.({ text, delta: text });
    return { text, truncated: false, modelTierApplied: options.modelTier || "default" };
  }
  sample.json = async (input, options = {}) => {
    if (mode === "declined") throw { code: "not_granted", message: "The viewer declined." };
    await wait(200);
    return scripted(input, true);
  };
  sample.limits = async () => ({ maxPromptBytes: 262144 });

  const docs = new Map();
  const listeners = new Map();
  const snap = (path) => ({ exists: docs.has(path), data: () => docs.get(path), metadata: { fromCache: false, hasPendingWrites: false } });
  const db = {
    doc(path) {
      return {
        path,
        async get() {
          return snap(path);
        },
        async set(data) {
          docs.set(path, structuredClone(data));
          (listeners.get(path) || []).forEach((fn) => fn(snap(path)));
        },
        onSnapshot(next) {
          listeners.set(path, [...(listeners.get(path) || []), next]);
          setTimeout(() => next(snap(path)), 100);
          return () => {};
        },
      };
    },
  };

  let fullAccess = mode === "local-ask" ? "prompt" : "granted";
  const post = async (url, body) => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(`EPERM: ${value.error}`);
    return value;
  };
  const fsCall = (op, path, extra = {}) =>
    post("/dev/fs", { op, path, ...extra }).then((reply) => {
      if (reply.error) throw new Error(reply.error);
      return reply.value;
    });
  function spawn(file, args = []) {
    const handlers = { data: [], err: [], close: [], error: [] };
    let input = "";
    const emit = (name, ...values) => handlers[name].forEach((fn) => fn(...values));
    return {
      pid: Promise.resolve(1),
      stdout: { on: (event, fn) => event === "data" && handlers.data.push(fn) },
      stderr: { on: (event, fn) => event === "data" && handlers.err.push(fn) },
      stdin: {
        write: async (data) => {
          input += data;
        },
        end: async () => {
          post("/dev/spawn", { file, args, input }).then(
            (result) => {
              if (result.stdout) emit("data", result.stdout);
              if (result.stderr) handlers.err.forEach((fn) => fn(result.stderr));
              emit("close", result.code, null);
            },
            (error) => emit("error", error),
          );
        },
      },
      on: (event, fn) => handlers[event]?.push(fn),
      kill: async () => {},
    };
  }
  const desktop = installed
    ? {
        install: { state: async () => "installed", request: async () => "installed" },
        permissions: {
          state: async (name) => (name === "full-access" ? fullAccess : "unavailable"),
          request: async () => {
            fullAccess = "granted";
            return { "full-access": fullAccess };
          },
          manage: async () => {},
        },
        app: { dock: { setIcon: async () => ({ written: false }) } },
        fs: {
          exists: (path) => fsCall("exists", path),
          lstat: (path) => fsCall("lstat", path),
          mkdir: (path, options) => fsCall("mkdir", path, { options }),
          writeFile: (path, data) => fsCall("writeFile", path, { data }),
          readFile: (path) => fsCall("readFile", path),
          realpath: (path) => fsCall("realpath", path),
        },
        os: { platform: async () => "darwin", arch: async () => "arm64", homedir: async () => window.__FAKE_HOME__ },
        shell: { trashItem: (path) => fsCall("trashItem", path), openPath: async () => {}, showItemInFolder: async () => {} },
        childProcess: {
          spawn,
          async exec(command, options = {}) {
            if (noDocker && /command -v docker/.test(command)) return { stdout: "", stderr: "", code: 1, signal: null, truncated: false };
            const response = await fetch("/dev/exec", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ command, input: options.input ?? "", timeout: options.timeout }),
            });
            if (!response.ok) throw new Error(`EPERM: ${(await response.json()).error}`);
            return response.json();
          },
        },
      }
    : { install: { state: async () => (mode === "none" ? "unavailable" : "available"), request: async () => "installed" } };

  const caps = {
    sample: mode === "none" ? null : sample,
    db,
    user: { id: async () => "u_local_preview", isOwner: async () => true, canEdit: async () => true, can: async () => true },
    desktop,
  };
  window.claude = {
    use: async (name) => {
      await wait(40);
      return caps[name] ?? null;
    },
  };
})();
