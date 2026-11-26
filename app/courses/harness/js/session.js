import { loadScript } from "../../../js/ui.js";
import { buildWorkerSource, transpileFiles } from "./bundle.js";

export const TYPESCRIPT_URL = "https://cdnjs.cloudflare.com/ajax/libs/typescript/5.9.3/typescript.min.js";
const TYPESCRIPT_INTEGRITY = "sha512-AexnMUNTmJMG6xQ9e40doFD2a7u1uYMNpda4hGXSw3gh3fMbNtGOfIHfbVCZvA8Gv55uCW5s5iPJk8yIPZAO8Q==";

export function loadTypeScript() {
  return loadScript(TYPESCRIPT_URL, "ts", TYPESCRIPT_INTEGRITY);
}

export async function createSession({ files, entry, onStep, onFetch }) {
  const ts = await loadTypeScript();
  const source = buildWorkerSource(transpileFiles(ts, files), entry);
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  let worker;
  try {
    worker = new Worker(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new Error(`This browser wouldn't start the harness sandbox (${error.message}).`);
  }

  const turns = new Map();
  let nextTurn = 0;
  let ready = false;
  let closed = false;

  const failAll = (message) => {
    for (const settle of turns.values()) settle({ type: "error", message });
    turns.clear();
  };

  const api = {
    send(text) {
      if (closed) return Promise.resolve({ type: "error", message: "This conversation was closed." });
      nextTurn += 1;
      const turn = nextTurn;
      return new Promise((settle) => {
        turns.set(turn, settle);
        worker.postMessage({ type: "send", turn, text });
      });
    },
    dispose() {
      if (closed) return;
      closed = true;
      worker.terminate();
      failAll("The conversation was reset.");
    },
  };

  return new Promise((resolve, reject) => {
    worker.onerror = (event) => {
      event.preventDefault?.();
      const message = `The harness code crashed: ${event.message || "unknown error"}`;
      if (!ready) {
        worker.terminate();
        URL.revokeObjectURL(url);
        reject(new Error(message));
      } else failAll(message);
    };
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "ready") {
        ready = true;
        URL.revokeObjectURL(url);
        resolve(api);
      } else if (message.type === "load-error") {
        worker.terminate();
        URL.revokeObjectURL(url);
        reject(new Error(message.message));
      } else if (message.type === "step") {
        onStep(message.step, message.turn);
      } else if (message.type === "fetch") {
        Promise.resolve()
          .then(() => onFetch(message))
          .then(
            (reply) => !closed && worker.postMessage({ type: "fetch-reply", id: message.id, status: reply.status, body: reply.body }),
            (error) => !closed && worker.postMessage({ type: "fetch-reply", id: message.id, error: String(error?.message ?? error) }),
          );
      } else if (message.type === "reply" || message.type === "error") {
        const settle = turns.get(message.turn);
        turns.delete(message.turn);
        settle?.(message);
      }
    };
  });
}
