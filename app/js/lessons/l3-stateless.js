import { estimateTokens } from "../core/tokens.js";
import { XRay, codeBlock, diagram, engineers, h, playground, prose, renderAnswer, runner, sourceLink } from "../ui.js";

export const STARTERS = [
  "Hi! I'm Sam, and I'm planning a lunch for my team of 8 people next Friday.",
  "Two people are vegetarian. What kind of food would work for everyone?",
  "What's my name, and how many people are coming?",
];
const MAX_TURNS_KEPT = 24;

export function buildTurns(history, message, rememberHistory) {
  const turn = { role: "user", content: message };
  return rememberHistory ? [...history, turn] : [turn];
}

const RESEND_SVG = `
<svg viewBox="0 0 640 176" role="img" aria-labelledby="l3d-t l3d-d">
  <title id="l3d-t">Every turn resends the whole conversation</title>
  <desc id="l3d-d">Turn one sends one message. Turn two sends three messages: the first question, the first answer and the new question. Turn three sends five.</desc>
  <g class="d-small">
    <text x="8" y="34">Turn 1 sends</text>
    <text x="8" y="90">Turn 2 sends</text>
    <text x="8" y="146">Turn 3 sends</text>
  </g>
  <g class="d-you"><rect x="112" y="16" width="70" height="28" rx="6"/></g>
  <g class="d-you"><rect x="112" y="72" width="70" height="28" rx="6"/><rect x="264" y="72" width="70" height="28" rx="6"/></g>
  <g class="d-model"><rect x="188" y="72" width="70" height="28" rx="6"/></g>
  <g class="d-you"><rect x="112" y="128" width="70" height="28" rx="6"/><rect x="264" y="128" width="70" height="28" rx="6"/><rect x="416" y="128" width="70" height="28" rx="6"/></g>
  <g class="d-model"><rect x="188" y="128" width="70" height="28" rx="6"/><rect x="340" y="128" width="70" height="28" rx="6"/></g>
  <g class="d-chip-text">
    <text x="147" y="35" text-anchor="middle">you</text>
    <text x="147" y="91" text-anchor="middle">you</text><text x="223" y="91" text-anchor="middle">Claude</text><text x="299" y="91" text-anchor="middle">you</text>
    <text x="147" y="147" text-anchor="middle">you</text><text x="223" y="147" text-anchor="middle">Claude</text><text x="299" y="147" text-anchor="middle">you</text><text x="375" y="147" text-anchor="middle">Claude</text><text x="451" y="147" text-anchor="middle">you</text>
  </g>
  <g class="d-small"><text x="500" y="147">5 messages</text><text x="348" y="91">3 messages</text><text x="196" y="35">1 message</text></g>
</svg>`;

export default {
  id: "l3",
  n: 3,
  title: "Chat is stateless",
  blurb: "Watch the whole history get sent again on every turn.",
  minutes: 5,
  render(root, ctx) {
    const xray = new XRay();
    let history = [];
    const sentSizes = [];
    const log = h("div", { class: "chat-log", "aria-live": "polite" });
    const box = h("textarea", { id: "l3-message", class: "input", rows: "2", placeholder: "Type a message" });
    box.value = STARTERS[0];
    const remember = h("input", { type: "checkbox", id: "l3-remember", checked: true });
    const sizes = h("ol", { class: "size-bars", "aria-label": "Tokens sent per turn" });
    const suggestions = h(
      "div",
      { class: "chips" },
      h("span", { class: "chips-label" }, "Try:"),
      STARTERS.map((text) => h("button", { type: "button", class: "chip-btn", onclick: () => (box.value = text) }, text)),
    );

    const bubble = (role, text) =>
      h("div", { class: `bubble bubble-${role}` }, h("span", { class: "bubble-who" }, role === "user" ? "You" : "Claude"), h("div", { class: "bubble-text" }, renderAnswer(text)));

    const drawSizes = () => {
      const max = Math.max(...sentSizes.map((s) => s.tokens), 1);
      sizes.replaceChildren(
        ...sentSizes.map((s, i) =>
          h(
            "li",
            { class: s.remembered ? "" : "is-forgot" },
            h("span", { class: "size-label" }, `Turn ${i + 1}`),
            h("span", { class: "size-track" }, h("span", { class: "size-fill", style: `width:${(s.tokens / max) * 100}%` })),
            h("span", { class: "size-value" }, `${s.messages} msg · ~${s.tokens} tokens`),
          ),
        ),
      );
    };

    const send = runner(ctx, {
      label: "Send",
      busyLabel: "Sending…",
      async run(signal, status) {
        const message = box.value.trim();
        if (!message) {
          status("Type a message first.");
          return;
        }
        const turns = buildTurns(history, message, remember.checked);
        log.append(bubble("user", message));
        const pending = h("div", { class: "bubble bubble-assistant" }, h("span", { class: "bubble-who" }, "Claude"), h("p", { class: "thinking" }, "Thinking…"));
        log.append(pending);
        sentSizes.push({ messages: turns.length, tokens: estimateTokens(turns.map((t) => t.content).join("")), remembered: remember.checked });
        drawSizes();
        box.value = "";
        try {
          const result = await ctx.runtime.callModel(
            turns,
            { modelTier: "quick", cache: false, signal },
            {
              xray,
              why: remember.checked
                ? turns.length === 1
                  ? "The first turn: just your message."
                  : "The page resent every earlier message, because Claude keeps no memory between requests."
                : "History is off, so only your newest message went. Claude can't see the earlier chat.",
            },
          );
          pending.replaceWith(bubble("assistant", result.text));
          history = [...history, { role: "user", content: message }, { role: "assistant", content: result.text }].slice(-MAX_TURNS_KEPT);
          status("");
        } catch (error) {
          pending.remove();
          log.lastElementChild?.remove();
          sentSizes.pop();
          drawSizes();
          box.value = message;
          throw error;
        }
      },
    });

    const clear = h(
      "button",
      {
        class: "btn btn-quiet",
        type: "button",
        onclick: () => {
          history = [];
          sentSizes.length = 0;
          log.replaceChildren();
          drawSizes();
          xray.clear();
          box.value = STARTERS[0];
        },
      },
      "New chat",
    );

    root.append(
      prose(`
        <p>When you chat with an AI assistant, it feels like it remembers what you said a minute ago. It doesn't. Each time you press send, the app packs the <em>whole conversation so far</em> into a new request and sends all of it. The model reads it from the top, writes the next reply, and then forgets everything again.</p>
        <p>This is what <dfn>stateless</dfn> means: the model keeps no memory between requests. The memory lives in the app, which stores the conversation and replays it each turn.</p>
      `),
      diagram(RESEND_SVG, "Each new turn carries every earlier message along with it."),
      prose(`
        <h2>Why it matters</h2>
        <ul>
          <li><strong>Long chats get heavier.</strong> Every turn resends everything, so later turns use more tokens and count more toward your limits.</li>
          <li><strong>Long chats can run out of room.</strong> Eventually the history won't fit in the context window. Lesson 5 covers what apps do about that.</li>
          <li><strong>A fresh chat is a clean slate.</strong> Starting a new conversation means the model sees none of the old one. That's useful when an old chat has drifted off course.</li>
        </ul>
      `),
      playground(ctx, {
        intro: "Chat with Claude and watch the x-ray: every request contains the full history. Then switch history off and ask what it remembers.",
        children: [
          h(
            "div",
            { class: "pg-part" },
            suggestions,
            log,
            h("div", { class: "field" }, h("label", { for: "l3-message", class: "field-label" }, "Your message"), box),
            h("label", { class: "toggle", for: "l3-remember" }, remember, h("span", {}, "Resend the history with each message (what real chat apps do)")),
            h("div", { class: "run-line" }, send, clear),
            h("h3", { class: "pg-sub" }, "What each turn sent"),
            sizes,
          ),
          xray.el,
        ],
      }),
      engineers(
        "Keeping the conversation yourself",
        prose(`<p>With the Claude API you hold the conversation in your own code and send the full list every time. The first message must be from the user, and roles then usually alternate.</p>`),
        codeBlock(
          `const messages = [];

async function chat(text) {
  messages.push({ role: "user", content: text });
  const reply = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 1024,
    messages,                  // the whole history, every time
  });
  const answer = reply.content.find((b) => b.type === "text")?.text ?? "";
  messages.push({ role: "assistant", content: answer });
  return answer;
}`,
          "A chat loop in JavaScript with the Anthropic SDK",
        ),
        prose(`<p>Resending a long, unchanged prefix is where <dfn>prompt caching</dfn> pays off: the provider can reuse work on the repeated start of the request, so it costs less and comes back faster. The request is still the full conversation. Caching only makes the repeated part cheaper.</p>`),
        h(
          "p",
          { class: "fineprint" },
          "Sources: ",
          sourceLink("https://platform.claude.com/docs/en/build-with-claude/prompt-caching", "Prompt caching"),
          ".",
        ),
      ),
    );
  },
  quiz: [
    {
      q: "How does a chat app make the model “remember” your earlier messages?",
      options: ["The model saves each chat to its own memory", "The app sends the whole conversation again with every new message", "It only remembers your name", "The model reads your email"],
      answer: 1,
      why: "The model is stateless. The app stores the chat and replays it in every request.",
    },
    {
      q: "Why do very long chats use more of your usage?",
      options: ["Long chats are billed at a higher rate", "Each new turn resends all earlier messages, so requests keep growing", "The model types slower", "They don't"],
      answer: 1,
      why: "The x-ray shows request size growing every turn, even for a short new question.",
    },
    {
      q: "When you switched history off and asked “What's my name?”, what happened?",
      options: ["Claude knew your name anyway", "Claude couldn't know, because the earlier message wasn't in the request", "The page crashed", "Claude looked it up online"],
      answer: 1,
      why: "If it isn't in the request, the model can't see it. That's the whole idea of stateless.",
    },
  ],
};
