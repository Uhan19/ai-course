export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function trusted(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

export function commandLine(command) {
  const code = h("code", {}, command);
  const copy = h("button", { type: "button", class: "btn btn-quiet btn-small" }, "Copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command);
      copy.textContent = "Copied";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      copy.textContent = "Selected";
    }
    setTimeout(() => (copy.textContent = "Copy"), 1500);
  });
  return h("div", { class: "command" }, code, copy);
}

const loading = new Map();

export function loadScript(url, globalName) {
  if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  if (!loading.has(url)) {
    loading.set(
      url,
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.async = true;
        script.onload = () => (globalThis[globalName] ? resolve(globalThis[globalName]) : reject(new Error(`${url} loaded without ${globalName}`)));
        script.onerror = () => {
          loading.delete(url);
          reject(new Error(`Couldn't load ${url}`));
        };
        document.head.append(script);
      }),
    );
  }
  return loading.get(url);
}

export function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
