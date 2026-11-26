(() => {
  const mode = window.__FAKE_MODE__ || "fallback";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const installed = mode === "local" || mode === "local-ask";

  const allText = (input) => (typeof input === "string" ? input : input.map((t) => t.content).join("\n"));
  const lastUser = (input) => (typeof input === "string" ? input : [...input].reverse().find((t) => t.role === "user")?.content ?? "");

  function scripted(input, json) {
    const text = allText(input);
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
        os: { platform: async () => "darwin", arch: async () => "arm64" },
        app: { dock: { setIcon: async () => ({ written: false }) } },
        childProcess: {
          async exec(command, options = {}) {
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
    permissions: { manage: async () => {}, state: async () => "granted" },
  };
  window.claude = {
    use: async (name) => {
      await wait(40);
      return caps[name] ?? null;
    },
  };
})();
