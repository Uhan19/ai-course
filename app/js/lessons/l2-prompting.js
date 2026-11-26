import { estimateTokens } from "../core/tokens.js";
import { XRay, codeBlock, engineers, h, playground, prose, renderAnswer, runner, sourceLink } from "../ui.js";

export const PROMPTS = [
  {
    name: "Vague",
    text: "Reply to a customer about a late order.",
  },
  {
    name: "Specific",
    text: "Write a short, friendly reply to a customer whose order arrived 5 days late. They asked for a refund. We can refund the shipping fee in full, or give them a 15% discount code for their next order. Keep it under 100 words.",
  },
  {
    name: "Structured",
    text: `You are writing an email for the support team of a small online bookshop.

Situation: a customer's order arrived 5 days late because of a warehouse mix-up. They are polite but annoyed, and they asked for a refund.

What we can offer: a full refund of the shipping fee, or a 15% discount code for their next order. They choose.

Write the reply. Rules:
- Under 100 words.
- One sentence of apology that names the cause. No excuses.
- List the two options as bullet points.
- End with: The Support Team

Example of the tone we like: "Thanks for telling us. That's not the experience we want you to have."`,
  },
];

function column(ctx, prompt, i) {
  const id = `l2-prompt-${i}`;
  const area = h("textarea", { id, class: "input", rows: "8", spellcheck: "true" });
  area.value = prompt.text;
  const count = h("span", { class: "field-hint" });
  const syncCount = () => (count.textContent = `about ${estimateTokens(area.value)} tokens`);
  area.addEventListener("input", syncCount);
  syncCount();
  const answer = h("div", { class: "answer is-empty" }, h("p", {}, "Waiting to run."));
  return {
    area,
    answer,
    el: h(
      "div",
      { class: "compare-col" },
      h("div", { class: "compare-head" }, h("label", { for: id, class: "compare-title" }, `${String.fromCharCode(65 + i)}. ${prompt.name}`), count),
      area,
      answer,
    ),
  };
}

export default {
  id: "l2",
  n: 2,
  title: "Prompting",
  blurb: "The same request asked three ways, compared side by side.",
  minutes: 6,
  render(root, ctx) {
    const xray = new XRay();
    const columns = PROMPTS.map((p, i) => column(ctx, p, i));
    const reset = h(
      "button",
      {
        class: "btn btn-quiet",
        type: "button",
        onclick: () => columns.forEach((c, i) => {
          c.area.value = PROMPTS[i].text;
          c.area.dispatchEvent(new Event("input"));
        }),
      },
      "Reset prompts",
    );
    const run = runner(ctx, {
      label: "Run all three",
      async run(signal, status) {
        xray.clear();
        for (const c of columns) c.answer.replaceChildren(h("p", { class: "thinking" }, "Waiting…"));
        for (let i = 0; i < columns.length; i += 1) {
          const c = columns[i];
          status(`Running prompt ${String.fromCharCode(65 + i)}…`);
          c.answer.replaceChildren(h("p", { class: "thinking" }, "Thinking…"));
          const result = await ctx.runtime.callModel(
            c.area.value,
            { modelTier: "quick", cache: false, signal },
            { xray, why: `Prompt ${String.fromCharCode(65 + i)} (${PROMPTS[i].name.toLowerCase()}) is the whole request. Claude knows only what it says.` },
          );
          c.answer.classList.remove("is-empty");
          c.answer.replaceChildren(renderAnswer(result.text));
        }
        status("Done. Which reply could you send without editing?");
      },
    });

    root.append(
      prose(`
        <p>A <dfn>prompt</dfn> is the text you send to the model. It is the model's only source of information about your situation. It doesn't know your company, your customer, or what you tried last week unless the prompt says so. When an answer feels generic, the prompt was usually generic too.</p>
        <h2>What a good prompt carries</h2>
        <ul>
          <li><strong>Context.</strong> Who is this for, and what happened?</li>
          <li><strong>The goal.</strong> What should the result let you do?</li>
          <li><strong>Constraints.</strong> Length, tone, things to avoid, what you can and can't offer.</li>
          <li><strong>Format.</strong> Bullet points, a table, an email with a sign-off.</li>
          <li><strong>An example</strong> of what good looks like, when you have one.</li>
        </ul>
        <p>You don't need special phrases or tricks. Write the way you would brief a smart new colleague on their first day. Be clear and specific, and give the background they would need.</p>
        <h2>Why this works</h2>
        <p>Remember lesson 1: the model predicts what comes next given the text it sees. A vague prompt fits thousands of possible replies, so you get an average one. Each detail you add narrows the field toward the reply you actually want.</p>
      `),
      playground(ctx, {
        intro: "Three prompts for the same job: answering a customer whose order arrived late. Run them, compare the replies, then edit any prompt and run again.",
        children: [h("div", { class: "pg-part" }, h("div", { class: "compare compare-tall" }, columns.map((c) => c.el)), h("div", { class: "run-line" }, run, reset)), xray.el],
      }),
      engineers(
        "System prompts, examples and structured output",
        prose(`
          <p>In the Claude API, standing instructions that apply to the whole conversation usually go in the top-level <code>system</code> field, separate from the <code>messages</code>. The artifact runtime this course uses has no system field, so standing instructions go in the first user turn instead. Lesson 5 shows that pattern.</p>
        `),
        codeBlock(
          `{
  "model": "claude-opus-5-5",
  "max_tokens": 1024,
  "system": "You write support emails for a small online bookshop. Under 100 words.",
  "messages": [
    { "role": "user", "content": "Order 5 days late, customer wants a refund. Offer: shipping refund or 15% code." }
  ]
}`,
          "Claude API request with a system prompt",
        ),
        prose(`
          <p>Examples are the most reliable way to fix format and tone: show one or two inputs with the exact outputs you want. When code needs to read the answer, ask for JSON. The API's structured outputs feature can enforce a JSON schema so you don't have to parse free text.</p>
        `),
        h(
          "p",
          { class: "fineprint" },
          "Further reading: ",
          sourceLink("https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview", "Prompt engineering overview"),
          ", ",
          sourceLink("https://platform.claude.com/docs/en/build-with-claude/structured-outputs", "Structured outputs"),
          ".",
        ),
      ),
    );
  },
  quiz: [
    {
      q: "Claude gives you a bland, generic reply. What is the most likely fix?",
      options: ["Ask the same thing again in capital letters", "Add the context, goal, constraints and format you have in mind", "Use a different browser", "Make the prompt shorter"],
      answer: 1,
      why: "The prompt is the model's only information about your situation. More relevant detail narrows the answer.",
    },
    {
      q: "Which of these is the best way to get a specific tone?",
      options: ["Add the word “please”", "Show a short example of the tone you like", "Say “you are the world's best writer”", "Ask for the answer twice"],
      answer: 1,
      why: "Examples show the model exactly what good looks like. Flattery and magic words don't add information.",
    },
    {
      q: "In the x-ray, what did each prompt's request contain?",
      options: ["Your prompt plus your company's files", "Only the prompt text in that column", "All three prompts at once", "Your previous chats with Claude"],
      answer: 1,
      why: "Each call carried only that column's prompt. Nothing else about you or your work was sent.",
    },
  ],
};
