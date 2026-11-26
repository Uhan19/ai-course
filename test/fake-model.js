export function installFakeModel(script) {
  const requests = [];
  const queue = [...script];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init.body)));
    const message = queue.shift();
    if (!message) throw new Error("The fake model ran out of scripted replies.");
    const reply = { model: "fake", message, done: true, prompt_eval_count: 10, eval_count: 5 };
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { requests, restore: () => (globalThis.fetch = original) };
}

export function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => (globalThis.fetch = original);
}

export function recordingXRay() {
  const steps = [];
  const xray = {
    request: (body, why) => steps.push({ kind: "request", why, data: structuredClone(body) }),
    response: (body, _ms, why) => steps.push({ kind: "response", why, data: body }),
    tool: (step, why) => steps.push({ kind: "tool", why, data: step }),
    note: (why) => steps.push({ kind: "note", why }),
  };
  return { xray, steps };
}

export function text(content) {
  return { role: "assistant", content };
}

export function toolCalls(...calls) {
  const tool_calls = calls.map(([name, args], index) => ({ id: `call_${index}`, function: { name, arguments: args } }));
  return { role: "assistant", content: "", tool_calls };
}
