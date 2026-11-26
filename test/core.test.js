import { test } from "node:test";
import assert from "node:assert/strict";
import { Deck, cardsVerdict, keyConceptDeck, scoreCards } from "../app/js/core/cards.js";
import { escapeHtml, renderFlow } from "../app/js/core/markdown.js";
import { LESSONS } from "../app/courses/harness/lessons.js";
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

function lesson(id, flashcards) {
  return { id, title: `Lesson ${id}`, flashcards };
}

function sequence(...values) {
  return () => values.shift() ?? 0;
}

test("key concept deck collects only key-concept cards, in lesson order, tagged with their lesson", () => {
  const deck = keyConceptDeck([
    lesson(0, [
      { front: "A", back: "a", keyConcept: true },
      { front: "B", back: "b" },
    ]),
    lesson(1, [{ front: "C", back: "c", keyConcept: true }]),
    { id: 2, title: "No cards" },
  ]);
  assert.deepEqual(deck, [
    { front: "A", back: "a", keyConcept: true, lessonId: 0, lessonTitle: "Lesson 0" },
    { front: "C", back: "c", keyConcept: true, lessonId: 1, lessonTitle: "Lesson 1" },
  ]);
});

test("every harness lesson has cards with a question, an answer and at least one key concept", () => {
  for (const { id, flashcards } of LESSONS) {
    assert.ok(flashcards.length > 0, `lesson ${id}`);
    assert.ok(flashcards.some((card) => card.keyConcept), `lesson ${id}`);
    for (const card of flashcards) {
      assert.notEqual(card.front.trim(), "", `lesson ${id}`);
      assert.notEqual(card.back.trim(), "", `lesson ${id}`);
    }
  }
});

test("deck starts on the first card with the answer hidden", () => {
  const deck = new Deck(["a", "b", "c"]);
  assert.deepEqual([deck.current, deck.position, deck.size, deck.revealed], ["a", 1, 3, false]);
  assert.deepEqual([deck.isFirst, deck.isLast], [true, false]);
});

test("deck flips, and hides the answer again when moving to another card", () => {
  const deck = new Deck(["a", "b"]);
  deck.flip();
  assert.equal(deck.revealed, true);
  deck.next();
  assert.deepEqual([deck.current, deck.position, deck.revealed], ["b", 2, false]);
  deck.flip();
  deck.previous();
  assert.deepEqual([deck.current, deck.revealed], ["a", false]);
});

test("deck stays put at either end", () => {
  const deck = new Deck(["a", "b"]);
  deck.previous();
  assert.equal(deck.current, "a");
  deck.next();
  deck.flip();
  deck.next();
  assert.deepEqual([deck.current, deck.isLast, deck.revealed], ["b", true, true]);
});

test("deck shuffles into a new order of the same cards and starts again from the first", () => {
  const deck = new Deck(["a", "b", "c", "d"]);
  deck.next();
  deck.flip();
  deck.shuffle(sequence(0, 0, 0));
  const seen = [deck.current];
  assert.deepEqual([deck.position, deck.revealed], [1, false]);
  while (!deck.isLast) {
    deck.next();
    seen.push(deck.current);
  }
  assert.deepEqual(seen, ["b", "c", "d", "a"]);
});

test("deck handles no cards", () => {
  const deck = new Deck([]);
  assert.deepEqual([deck.current, deck.size, deck.isFirst, deck.isLast], [undefined, 0, true, true]);
});

test("scoreCards counts known cards and completeness", () => {
  assert.deepEqual(scoreCards([true, null, false], 3), { score: 1, total: 3, answered: 2, complete: false, answers: [true, null, false] });
  const done = scoreCards([true, true, false, "x"], 3);
  assert.deepEqual([done.score, done.complete, done.answers], [2, true, [true, true, false]]);
  assert.equal(scoreCards([], 0).complete, false);
  assert.equal(cardsVerdict(scoreCards([true, true], 2)), "You knew every card.");
  assert.match(cardsVerdict(scoreCards([true, false], 2)), /1 of 2/);
  assert.equal(cardsVerdict(scoreCards([true], 2)), "");
});

test("flow blocks become rows of boxes and labelled arrows, escaped", () => {
  const html = renderFlow("You -[message]-> Harness -> Model\nModel -[<b>]-> Tool");
  assert.equal((html.match(/flow-row/g) ?? []).length, 2);
  assert.match(html, /<span class="flow-node flow-you">You<\/span>/);
  assert.match(html, /<span class="flow-label">message<\/span>/);
  assert.match(html, /<span class="flow-label">&#60;b&#62;<\/span>/);
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&#60;a href=&#34;x&#34;&#62;&#39;&#38;&#39;&#60;/a&#62;");
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
  const partial = recordQuiz(p, "l3", { score: 1, total: 2, answers: [true, null] }, 500, false);
  assert.equal(lessonStatus(partial, "l3"), "started");
  assert.equal(partial.lessons.l3.quiz.best, 0);
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
