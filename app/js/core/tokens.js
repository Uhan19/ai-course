export const CHARS_PER_TOKEN = 2.5;
export const CONTEXT_WINDOW_TOKENS = 1_000_000;
export const TOKEN_SOURCE = {
  url: "https://platform.claude.com/docs/en/about-claude/models/overview",
  quote: "1M tokens is roughly 555k words or 2.5M Unicode characters on the current tokenizer.",
  read: "2026-11-25",
};

const PIECE_PATTERN = /\s*[\p{L}\p{M}]+|\s*\p{N}+|\s*[^\s\p{L}\p{M}\p{N}]|\s+/gu;
const WHOLE_WORD_MAX = 5;
const CHUNK = 3;
const DIGIT_GROUP = 3;

export function estimateTokens(text) {
  const length = [...String(text ?? "")].length;
  return length === 0 ? 0 : Math.ceil(length / CHARS_PER_TOKEN);
}

export function illustrateTokens(text) {
  const pieces = [];
  for (const match of String(text ?? "").matchAll(PIECE_PATTERN)) {
    pieces.push(...splitPiece(match[0]));
  }
  return pieces;
}

function splitPiece(piece) {
  const lead = piece.match(/^\s*/)[0];
  const body = piece.slice(lead.length);
  if (!body) return lead ? [lead] : [];
  if (/^\p{N}+$/u.test(body)) return chunk(body, DIGIT_GROUP, lead);
  if (/^[\p{L}\p{M}]+$/u.test(body) && [...body].length > WHOLE_WORD_MAX) return chunk(body, CHUNK, lead);
  return [piece];
}

function chunk(body, size, lead) {
  const chars = [...body];
  const parts = [];
  for (let i = 0; i < chars.length; i += size) parts.push(chars.slice(i, i + size).join(""));
  parts[0] = lead + parts[0];
  return parts;
}

export function shareOfWindow(tokens, windowTokens = CONTEXT_WINDOW_TOKENS) {
  if (windowTokens <= 0) return 0;
  return Math.min(1, Math.max(0, tokens / windowTokens));
}
