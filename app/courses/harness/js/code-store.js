import { HARNESS_FILES } from "../files.js";

const DRAFTS_KEY = "primer.harness.drafts.v1";
const COURSE_ROOT = new URL("../", import.meta.url);

function readDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDrafts(drafts) {
  try {
    if (Object.keys(drafts).length) localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    else localStorage.removeItem(DRAFTS_KEY);
  } catch {
    // Drafts are a convenience; the page works without storage.
  }
}

export function courseUrl(path) {
  return new URL(path, COURSE_ROOT).href;
}

export async function fetchText(path) {
  const response = await fetch(courseUrl(path));
  if (!response.ok) throw new Error(`Couldn't load ${path} (${response.status}).`);
  return response.text();
}

export function createCodeStore() {
  const originals = {};
  const drafts = Object.fromEntries(Object.entries(readDrafts()).filter(([path, text]) => HARNESS_FILES.includes(path) && typeof text === "string"));
  const listeners = new Set();
  let loading = null;

  const notify = (path) => listeners.forEach((fn) => fn(path));

  return {
    load() {
      loading ??= Promise.all(HARNESS_FILES.map(async (path) => (originals[path] = await fetchText(path)))).catch((error) => {
        loading = null;
        throw error;
      });
      return loading;
    },
    get(path) {
      return drafts[path] ?? originals[path] ?? "";
    },
    original(path) {
      return originals[path] ?? "";
    },
    isEdited(path) {
      return path in drafts;
    },
    set(path, text) {
      if (text === originals[path]) delete drafts[path];
      else drafts[path] = text;
      writeDrafts(drafts);
      notify(path);
    },
    reset(path) {
      delete drafts[path];
      writeDrafts(drafts);
      notify(path);
    },
    all() {
      return Object.fromEntries(HARNESS_FILES.map((path) => [path, this.get(path)]));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
