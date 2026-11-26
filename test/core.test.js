import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, illustrateTokens, shareOfWindow } from "../app/js/core/tokens.js";
import {
  describeError,
  describeRequest,
  describeResponse,
  errorCopy,
  inputStats,
  requestRecord,
  responseRecord,
  errorRecord,
} from "../app/js/core/xray.js";
import { scoreQuiz, quizVerdict } from "../app/js/core/quiz.js";
import {
  emptyProgress,
  lessonStatus,
  markVisited,
  mergeProgress,
  nextLessonId,
  normalizeProgress,
  progressSummary,
  recordQuiz,
} from "../app/js/core/progress.js";

test("estimateTokens uses the documented characters-per-token ratio", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens("a"), 1);
  assert.equal(estimateTokens("é".repeat(10)), 4);
});

test("illustrateTokens keeps every character and splits long words", () => {
  const text = "Our team offsite is on Thursday, 2026!";
  const pieces = illustrateTokens(text);
  assert.equal(pieces.join(""), text);
  assert.ok(pieces.includes(" Thu"));
  assert.ok(pieces.includes(" 202"));
  assert.ok(pieces.includes(","));
});

test("shareOfWindow clamps to 0..1", () => {
  assert.equal(shareOfWindow(500_000), 0.5);
  assert.equal(shareOfWindow(5_000_000), 1);
  assert.equal(shareOfWindow(-1), 0);
});

test("requestRecord keeps what is sent and drops callbacks", () => {
  const signal = new AbortController().signal;
  const record = requestRecord([{ role: "user", content: "hi" }], {
    modelTier: "quick",
    cache: false,
    signal,
    onText: () => {},
    tools: [{ name: "clock", description: "Time", execute: () => 1 }],
  });
  assert.deepEqual(record, {
    capability: "sample",
    input: [{ role: "user", content: "hi" }],
    options: { modelTier: "quick", cache: false, tools: [{ name: "clock", description: "Time" }] },
  });
  assert.equal(requestRecord("hi").options, undefined);
});

test("inputStats and describeRequest summarise the request", () => {
  const turns = [
    { role: "user", content: "Hello there" },
    { role: "assistant", content: "Hi!" },
    { role: "user", content: "What's my name?" },
  ];
  const stats = inputStats(turns);
  assert.equal(stats.messages, 3);
  assert.equal(stats.chars, 29);
  assert.equal(describeRequest("Hello", "Because."), "Sent 1 message (about 2 tokens) to Claude. Because.");
  assert.match(describeRequest(turns), /^Sent 3 messages \(about 12 tokens\)/);
});

test("describeResponse and records", () => {
  assert.equal(describeResponse({ text: "one two three" }, 1530), "Claude replied with 3 words in 1.5 s.");
  assert.match(describeResponse({ text: "x", truncated: true }, 1000), /cut off/);
  assert.deepEqual(responseRecord({ text: "a", truncated: false, modelTierApplied: "quick" }), {
    text: "a",
    truncated: false,
    modelTierApplied: "quick",
  });
  assert.deepEqual(errorRecord({ code: "refused", message: "no" }), { code: "refused", message: "no" });
});

test("errorCopy distinguishes usage limits from rate limits", () => {
  assert.match(errorCopy({ code: "rate_limited" }), /Too many/);
  assert.match(errorCopy({ code: "rate_limited", reason: "usage_limit" }), /usage limit/);
  assert.match(errorCopy({ code: "something_new" }), /couldn't be reached/);
  assert.match(describeError({ code: "not_granted" }), /code: not_granted/);
});

test("scoreQuiz counts correct answers and completeness", () => {
  const questions = [{ answer: 1 }, { answer: 0 }, { answer: 2 }];
  const partial = scoreQuiz(questions, [1, null, 2]);
  assert.equal(partial.score, 2);
  assert.equal(partial.complete, false);
  const full = scoreQuiz(questions, [1, 0, 0]);
  assert.deepEqual([full.score, full.total, full.complete], [2, 3, true]);
  assert.equal(quizVerdict({ score: 3, total: 3 }), "All correct.");
  assert.match(quizVerdict({ score: 0, total: 3 }), /another look/);
});

test("progress records visits, quizzes and best scores", () => {
  let p = emptyProgress();
  p = markVisited(p, "l1", 100);
  assert.equal(lessonStatus(p, "l1"), "started");
  assert.equal(markVisited(p, "l1", 200), p);
  p = recordQuiz(p, "l1", { score: 3, total: 3, answers: [1, 2, 1] }, 300);
  p = recordQuiz(p, "l1", { score: 1, total: 3, answers: [0, 2, 1] }, 400);
  assert.equal(lessonStatus(p, "l1"), "done");
  assert.deepEqual(p.lessons.l1.quiz, { score: 1, total: 3, best: 3, answers: [0, 2, 1], takenAt: 400 });
  assert.equal(p.lessons.l1.completedAt, 300);
  assert.deepEqual(progressSummary(p, ["l1", "l2"]), { done: 1, total: 2, percent: 50 });
  assert.equal(nextLessonId(p, ["l1", "l2"]), "l2");
  assert.equal(nextLessonId(recordQuiz(p, "l2", { score: 0, total: 1, answers: [0] }), ["l1", "l2"]), null);
});

test("normalizeProgress tolerates junk", () => {
  assert.deepEqual(normalizeProgress(null), emptyProgress());
  assert.deepEqual(normalizeProgress({ lessons: { l1: 5, l2: { visitedAt: 1 } } }), { version: 1, lessons: { l2: { visitedAt: 1 } } });
});

test("mergeProgress keeps the earliest visit and the latest quiz", () => {
  const remote = { version: 1, lessons: { l1: { visitedAt: 50, completedAt: 60, quiz: { score: 3, total: 3, best: 3, answers: [], takenAt: 60 } } } };
  const local = { version: 1, lessons: { l1: { visitedAt: 100 }, l2: { visitedAt: 120 } } };
  const merged = mergeProgress(remote, local);
  assert.equal(merged.lessons.l1.visitedAt, 50);
  assert.equal(merged.lessons.l1.completedAt, 60);
  assert.equal(merged.lessons.l1.quiz.score, 3);
  assert.deepEqual(merged.lessons.l2, { visitedAt: 120 });
});
