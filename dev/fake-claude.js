(() => {
  const mode = window.__FAKE_MODE__ || "ready";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let replyCount = 0;

  function lastUserText(input) {
    if (typeof input === "string") return input;
    for (let i = input.length - 1; i >= 0; i -= 1) if (input[i].role === "user") return input[i].content;
    return "";
  }

  function allText(input) {
    return typeof input === "string" ? input : input.map((t) => t.content).join("\n");
  }

  function scriptedReply(input) {
    const text = allText(input);
    const last = lastUserText(input);
    replyCount += 1;
    if (/Reply with exactly one JSON object/.test(text)) {
      const results = (text.match(/Result of /g) || []).length;
      if (/post_to_board/.test(text) && /BOARD/.test(text) && results === 0) {
        return '{"type":"tool","tool":"post_to_board","input":{"message":"Office closed tomorrow"}}';
      }
      if (results === 0) return '{"type":"tool","tool":"calculator","input":{"expression":"2340 * 0.17"}}';
      if (results === 1 && /clock/.test(last + text) && /time/i.test(text)) return '{"type":"tool","tool":"clock","input":{}}';
      return '{"type":"answer","text":"(Scripted reply) 17% of 2,340 is 397.8."}';
    }
    if (/Reply with only a JSON/i.test(text)) {
      return JSON.stringify({ scores: [], note: "scripted" });
    }
    if (/name/i.test(last) && /Sam/.test(text)) return "(Scripted reply) Your name is Sam, and 8 people are coming.";
    return `(Scripted reply ${replyCount}) This is a fake answer from the local preview. It echoes the start of your prompt: “${last.slice(0, 60)}”.`;
  }

  async function sample(input, options = {}) {
    if (mode === "declined") throw { code: "not_granted", message: "The viewer declined." };
    if (mode === "limited") throw { code: "rate_limited", message: "Slow down." };
    await wait(250);
    if (options.signal?.aborted) throw { code: "cancelled", message: "cancelled" };
    const text = scriptedReply(input);
    options.onText?.({ text, delta: text });
    return { text, truncated: false, modelTierApplied: options.modelTier || "default" };
  }
  sample.json = async (input, options) => {
    const { text } = await sample(input, options);
    try {
      return JSON.parse(text);
    } catch {
      throw { code: "invalid_json", message: "not json", text };
    }
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 8 } });

  const docs = new Map();
  const listeners = new Map();
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
          const list = listeners.get(path) || [];
          list.push(next);
          listeners.set(path, list);
          setTimeout(() => next(snap(path)), 100);
          return () => {};
        },
      };
    },
  };
  const snap = (path) => ({
    exists: docs.has(path),
    data: () => docs.get(path),
    metadata: { fromCache: false, hasPendingWrites: false },
  });

  const caps = {
    sample,
    db,
    user: { id: async () => "u_local_preview", isOwner: async () => true, canEdit: async () => true, can: async () => true },
    desktop: { install: { state: async () => "available", request: async () => "installed" } },
    permissions: { manage: async () => {}, state: async () => "granted" },
  };
  window.claude = {
    use: async (name) => {
      await wait(50);
      return caps[name] ?? null;
    },
  };
})();
