import { CONTEXT_WINDOW_TOKENS, TOKEN_SOURCE, estimateTokens, illustrateTokens, shareOfWindow } from "../core/tokens.js";
import { XRay, codeBlock, diagram, engineers, field, h, playground, prose, runner, sourceLink, renderAnswer } from "../ui.js";

const SAMPLE_TEXT = "Our team offsite is on Thursday. Please bring your laptop, a charger, and a reusable water bottle!";
const VARY_PROMPT = "Suggest one name for a weekly newsletter with tips for working well with AI tools. Reply with just the name.";
const RUNS = 3;

const NEXT_TOKEN_SVG = `
<svg viewBox="0 0 640 150" role="img" aria-labelledby="l1d-t l1d-d">
  <title id="l1d-t">Predicting the next token</title>
  <desc id="l1d-d">The text so far, The meeting is moved to, goes into the model, which scores possible next tokens: Friday 46 percent, tomorrow 31 percent, next 12 percent, the 6 percent.</desc>
  <g class="d-box"><rect x="8" y="46" width="236" height="52" rx="10"/></g>
  <text class="d-text" x="24" y="78">The meeting is moved to</text>
  <path class="d-arrow" d="M252 72 H300" marker-end="url(#l1-arrow)"/>
  <g class="d-accent-box"><rect x="304" y="40" width="96" height="64" rx="12"/></g>
  <text class="d-label-strong" x="352" y="78" text-anchor="middle">model</text>
  <path class="d-arrow" d="M408 72 H446" marker-end="url(#l1-arrow)"/>
  <g class="d-bars">
    <rect x="452" y="18" width="${0.46 * 160}" height="22" rx="4"/>
    <rect x="452" y="48" width="${0.31 * 160}" height="22" rx="4"/>
    <rect x="452" y="78" width="${0.12 * 160}" height="22" rx="4"/>
    <rect x="452" y="108" width="${0.06 * 160}" height="22" rx="4"/>
  </g>
  <g class="d-small">
    <text x="${452 + 0.46 * 160 + 8}" y="34">“ Friday” 46%</text>
    <text x="${452 + 0.31 * 160 + 8}" y="64">“ tomorrow” 31%</text>
    <text x="${452 + 0.12 * 160 + 8}" y="94">“ next” 12%</text>
    <text x="${452 + 0.06 * 160 + 8}" y="124">“ the” 6%</text>
  </g>
  <defs><marker id="l1-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="d-arrowhead" d="M0 0 L10 5 L0 10 z"/></marker></defs>
</svg>`;

function tokenPlayground(ctx) {
  const { el, input } = field({ label: "Type or paste any text", id: "l1-text", value: SAMPLE_TEXT, rows: 3 });
  const strip = h("p", { class: "token-strip", "aria-label": "Text split into token-sized pieces" });
  const stats = h("dl", { class: "stat-row" });
  const meter = h("span", { class: "meter-fill" });
  const meterLabel = h("p", { class: "meter-label" });
  const update = () => {
    const text = input.value;
    const pieces = illustrateTokens(text);
    strip.replaceChildren(
      ...pieces.map((piece, i) => h("span", { class: `tok tok-${i % 4}` }, piece.replace(/ /g, "·").replace(/\n/g, "⏎"))),
    );
    const tokens = estimateTokens(text);
    const share = shareOfWindow(tokens);
    stats.replaceChildren(
      h("div", {}, h("dt", {}, "Characters"), h("dd", {}, [...text].length.toLocaleString("en-US"))),
      h("div", {}, h("dt", {}, "Pieces shown"), h("dd", {}, pieces.length.toLocaleString("en-US"))),
      h("div", {}, h("dt", {}, "Estimated tokens"), h("dd", {}, tokens.toLocaleString("en-US"))),
    );
    meter.style.width = `${Math.max(share * 100, tokens ? 0.4 : 0)}%`;
    meterLabel.textContent = `This text fills about ${(share * 100).toFixed(4)}% of a ${CONTEXT_WINDOW_TOKENS.toLocaleString("en-US")}-token context window.`;
  };
  input.addEventListener("input", update);
  update();
  return h(
    "div",
    { class: "pg-part" },
    h("h3", { class: "pg-sub" }, "Part 1: see the pieces"),
    h("p", { class: "pg-note" }, "This part runs entirely in your browser. No Claude call is needed."),
    el,
    strip,
    stats,
    h("div", { class: "meter", role: "presentation" }, meter),
    meterLabel,
    h(
      "p",
      { class: "fineprint" },
      "The split above is a teaching illustration, not Claude's real tokenizer, which splits text its own way. The estimate uses the ratio in Claude's docs: “",
      TOKEN_SOURCE.quote,
      "” ",
      sourceLink(TOKEN_SOURCE.url, "Models overview", TOKEN_SOURCE.read),
    ),
  );
}

function varyPlayground(ctx) {
  const xray = new XRay();
  const { el, input } = field({ label: "Question", id: "l1-vary", value: VARY_PROMPT, rows: 2 });
  const columns = Array.from({ length: RUNS }, (_, i) => {
    const body = h("div", { class: "answer is-empty" }, h("p", {}, "Waiting to run."));
    return { body, el: h("div", { class: "compare-col" }, h("h4", { class: "compare-title" }, `Answer ${i + 1}`), body) };
  });
  const run = runner(ctx, {
    label: `Ask ${RUNS} times`,
    async run(signal, status) {
      xray.clear();
      for (const col of columns) col.body.replaceChildren(h("p", { class: "thinking" }, "Waiting…"));
      for (let i = 0; i < RUNS; i += 1) {
        status(`Asking ${i + 1} of ${RUNS}…`);
        columns[i].body.replaceChildren(h("p", { class: "thinking" }, "Thinking…"));
        const result = await ctx.runtime.callModel(
          input.value,
          { modelTier: "quick", cache: false, signal },
          {
            xray,
            why: i === 0 ? "This is the whole request: just your question." : "The exact same request again, word for word.",
            answerWhy: i === 0 ? "" : "Same input, and the answer may still differ, because each word is picked with a bit of chance.",
          },
        );
        columns[i].body.classList.remove("is-empty");
        columns[i].body.replaceChildren(renderAnswer(result.text));
      }
      status("Done. Compare the three answers.");
    },
  });
  return h(
    "div",
    { class: "pg-part" },
    h("h3", { class: "pg-sub" }, "Part 2: same question, three answers"),
    h("p", { class: "pg-note" }, "Sends the same question three times. Open the x-ray to check that the requests are identical."),
    el,
    run,
    h("div", { class: "compare" }, columns.map((c) => c.el)),
    xray.el,
  );
}

export default {
  id: "l1",
  n: 1,
  title: "What a model is",
  blurb: "Tokens, the context window, and why the same question gets different answers.",
  minutes: 6,
  render(root, ctx) {
    root.append(
      prose(`
        <p>A <dfn>language model</dfn> is a program trained on a huge amount of text to do one thing: given some text, predict what comes next. When you ask Claude a question, it writes the answer one small piece at a time. It picks each piece based on everything that came before it, including the pieces it just wrote.</p>
        <h2>Tokens</h2>
        <p>Those small pieces are called <dfn>tokens</dfn>. A token is a chunk of text, often a short word, part of a longer word, a number, or a punctuation mark. Models read and write tokens, not letters or whole words. Usage limits and prices are counted in tokens too, which is why they come up again in lesson 9.</p>
      `),
      diagram(NEXT_TOKEN_SVG, "At each step the model scores every possible next token, then picks one. The numbers here are made up for illustration."),
      prose(`
        <h2>The context window</h2>
        <p>The <dfn>context window</dfn> is the most text a model can consider at once. It holds everything for one request: your question, any documents you include, the earlier conversation, and the answer being written. Anything outside the window, the model simply cannot see. Claude's current models have a window of 1 million tokens, which Claude's docs put at roughly 555,000 words.</p>
        <h2>Why answers vary</h2>
        <p>At each step the model has a list of likely next tokens with a probability for each. It does not always take the single most likely one. A little chance is built into the picking, so the same question can get a different answer each time. That helps for writing and brainstorming. When you need the same answer every time, you need other tools, like clear instructions, grounding in a document (lesson 6), and checks (lesson 7).</p>
      `),
      playground(ctx, {
        intro: "Part 1 shows text as token-sized pieces. Part 2 asks Claude the same question three times so you can watch the answers change.",
        children: [tokenPlayground(ctx), varyPlayground(ctx)],
      }),
      engineers(
        "What the request looks like on the wire",
        prose(`
          <p>This course calls Claude through the artifact runtime's <code>sample</code> function, so each call runs on the viewer's own account and no API key lives in the page. The x-ray shows exactly what the page passes to <code>sample</code>. When you call the Claude API yourself, the same question is a <code>POST /v1/messages</code> request. A minimal body looks like this:</p>
        `),
        codeBlock(
          `{
  "model": "claude-opus-5-5",
  "max_tokens": 1024,
  "messages": [
    { "role": "user", "content": "Suggest one name for a weekly newsletter..." }
  ]
}`,
          "Claude API request body",
        ),
        prose(`
          <p>The reply carries the text in a list of <code>content</code> blocks, a <code>stop_reason</code> such as <code>end_turn</code> or <code>max_tokens</code>, and a <code>usage</code> object with <code>input_tokens</code> and <code>output_tokens</code>. Those two numbers are what you are billed for. To measure a prompt before sending it, use the token counting endpoint instead of guessing from character counts.</p>
          <p>Older model APIs let you turn randomness down with a <code>temperature</code> setting. Don't build on that knob: on current Claude models, sending sampling settings is rejected. Ask for consistency in the prompt, or check the answer in code.</p>
        `),
        h(
          "p",
          { class: "fineprint" },
          "Sources: ",
          sourceLink("https://platform.claude.com/docs/en/build-with-claude/token-counting", "Token counting"),
          ", ",
          sourceLink("https://platform.claude.com/docs/en/about-claude/models/overview", "Models overview"),
          ".",
        ),
      ),
    );
  },
  quiz: [
    {
      q: "What is a token?",
      options: ["A password the model uses to log in", "A chunk of text, like a short word or part of a word", "One full sentence", "A single letter"],
      answer: 1,
      why: "Models read and write text in token-sized chunks. Usage and prices are counted in tokens.",
    },
    {
      q: "What is the context window?",
      options: [
        "The chat box where you type",
        "Everything the model has ever read",
        "The most text the model can consider in one request, including its own answer",
        "How long a chat stays open",
      ],
      answer: 2,
      why: "Anything outside the context window is invisible to the model for that request.",
    },
    {
      q: "You ask the exact same question twice and get two different answers. Why?",
      options: [
        "The model learned something new between the two questions",
        "Each next token is picked with some built-in chance",
        "Someone edited the answer",
        "The second request was sent to a different company",
      ],
      answer: 1,
      why: "The requests are identical, as the x-ray shows. The variation comes from how each next token is picked.",
    },
  ],
};
