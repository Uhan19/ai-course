const ARROW = /\s*-(?:\[([^\]]*)\])?->\s*/;
const SAFE_LINK = /^(?:https?:|mailto:)/i;

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function renderFlow(source) {
  const rows = source
    .trim()
    .split("\n")
    .map((line) => {
      const parts = line.split(ARROW);
      const cells = parts.map((part, index) => {
        if (index % 2 === 0) {
          const name = (part ?? "").trim();
          return `<span class="flow-node flow-${escapeHtml(name.toLowerCase().replace(/[^a-z0-9-]/g, ""))}">${escapeHtml(name)}</span>`;
        }
        return `<span class="flow-arrow"><span class="flow-label">${escapeHtml(part ?? "")}</span><span class="flow-line"></span></span>`;
      });
      return `<div class="flow-row">${cells.join("")}</div>`;
    });
  return `<figure class="flow">${rows.join("")}</figure>`;
}

export function createLessonMarkdown(Marked) {
  return new Marked({
    renderer: {
      code({ text, lang }) {
        return lang === "flow" ? renderFlow(text) : false;
      },
    },
  });
}

export function createReplyMarkdown(Marked) {
  return new Marked({
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      link({ href, tokens }) {
        const label = this.parser.parseInline(tokens);
        return SAFE_LINK.test(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
      },
      image({ text }) {
        return escapeHtml(text);
      },
    },
  });
}
