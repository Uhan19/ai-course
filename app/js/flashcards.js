import { Deck, cardsVerdict, keyConceptDeck, scoreCards } from "./core/cards.js";
import { recordQuiz } from "./core/progress.js";
import { h, trusted } from "./ui.js";

export function progressKey(course, lesson) {
  return `${course.id}-${lesson.id}`;
}

function inline(markdown, text) {
  return trusted(markdown.parseInline(text, { async: false }));
}

function flipCard(markdown, card, frontLabel, onToggle) {
  const labelClass = card.keyConcept ? "flashcard-label flashcard-label-key" : "flashcard-label";
  const front = h(
    "span",
    { class: "flashcard-face flashcard-front" },
    h("span", { class: labelClass }, frontLabel),
    h("span", { class: "flashcard-text" }, inline(markdown, card.front)),
  );
  const back = h(
    "span",
    { class: "flashcard-face flashcard-back" },
    h("span", { class: "flashcard-label" }, "Answer"),
    h("span", { class: "flashcard-text" }, inline(markdown, card.back)),
  );
  const root = h("button", { type: "button", class: "flashcard" }, h("span", { class: "flashcard-inner" }, front, back));
  const setFlipped = (flipped) => {
    root.classList.toggle("flipped", flipped);
    root.setAttribute("aria-pressed", String(flipped));
    front.setAttribute("aria-hidden", String(flipped));
    back.setAttribute("aria-hidden", String(!flipped));
  };
  root.addEventListener("click", () => setFlipped(onToggle()));
  setFlipped(false);
  return { root, setFlipped };
}

export function lessonFlashcards({ course, lesson, ctx, markdown }) {
  const cards = lesson.flashcards ?? [];
  if (cards.length === 0) return null;
  const key = progressKey(course, lesson);
  const saved = ctx.runtime.progress.value.lessons[key]?.quiz?.answers;
  const answers = cards.map((_, i) => (typeof saved?.[i] === "boolean" ? saved[i] : null));
  const summary = h("p", { class: "cards-summary", role: "status" });
  const marks = [];

  const save = () => {
    const scored = scoreCards(answers, cards.length);
    summary.textContent = scored.complete
      ? cardsVerdict(scored)
      : `${scored.answered} of ${cards.length} cards marked. Mark them all to finish this lesson.`;
    if (scored.answered > 0) {
      ctx.runtime.progress.update((p) => recordQuiz(p, key, { score: scored.score, total: scored.total, answers: scored.answers }, Date.now(), scored.complete));
    }
  };

  const grid = h(
    "div",
    { class: "flashcard-grid" },
    cards.map((card, index) => {
      let flipped = false;
      const flip = flipCard(markdown, card, card.keyConcept ? "★ Key concept" : "Question", () => (flipped = !flipped));
      const knew = h("button", { type: "button", class: "mark-btn", "aria-pressed": "false" }, "I knew it");
      const notYet = h("button", { type: "button", class: "mark-btn", "aria-pressed": "false" }, "Not yet");
      const sync = () => {
        knew.setAttribute("aria-pressed", String(answers[index] === true));
        notYet.setAttribute("aria-pressed", String(answers[index] === false));
      };
      const mark = (value) => () => {
        touched = true;
        answers[index] = value;
        sync();
        save();
      };
      knew.addEventListener("click", mark(true));
      notYet.addEventListener("click", mark(false));
      sync();
      marks.push(sync);
      return h("div", { class: "flashcard-cell" }, flip.root, h("div", { class: "mark-row", role: "group", "aria-label": "How did you do?" }, knew, notYet));
    }),
  );
  let touched = false;
  const showInitial = () => {
    const initial = scoreCards(answers, cards.length);
    summary.textContent = initial.complete ? cardsVerdict(initial) : "Answer each card in your head, flip it to check, then mark how you did.";
  };
  showInitial();
  ctx.watch((rt) => {
    if (touched) return;
    const stored = rt.progress.value.lessons[key]?.quiz?.answers;
    if (!stored) return;
    cards.forEach((_, i) => (answers[i] = typeof stored[i] === "boolean" ? stored[i] : null));
    marks.forEach((sync) => sync());
    showInitial();
  });

  return h(
    "section",
    { class: "lesson-flashcards", "aria-label": "Flashcards" },
    h("h2", {}, "Flashcards"),
    h(
      "p",
      { class: "flashcards-hint" },
      "Answer each question in your head, then click the card (or press Space on it) to check. Cards marked ★ Key concept are also in the ",
      h("a", { href: `#${course.id}-cards` }, "flashcards review deck"),
      ".",
    ),
    grid,
    summary,
  );
}

export function reviewPage({ course, ctx, markdown }) {
  const deck = new Deck(keyConceptDeck(course.lessons));
  const page = h(
    "div",
    { class: "review-page" },
    h("a", { href: "#", class: "crumb" }, "← All courses"),
    h("p", { class: "eyebrow" }, course.title),
    h("h1", { tabindex: "-1" }, "Flashcards"),
    h("p", { class: "lede" }, "The key concepts from every lesson in one deck. Read the question, answer it in your head, then flip the card to check."),
  );
  if (deck.size === 0) {
    page.append(h("p", {}, "No lesson has key-concept cards yet."));
    return page;
  }
  const stage = h("div", { class: "deck-stage" });
  const position = h("span", { class: "deck-position", "aria-live": "polite" });
  const previousButton = h("button", { type: "button", class: "btn btn-quiet" }, "← Previous");
  const flipButton = h("button", { type: "button", class: "btn btn-primary" }, "Show answer");
  const nextButton = h("button", { type: "button", class: "btn btn-quiet" }, "Next →");
  const shuffleButton = h("button", { type: "button", class: "btn btn-quiet" }, "Shuffle");
  let card;

  const syncControls = () => {
    position.textContent = `Card ${deck.position} of ${deck.size}`;
    previousButton.disabled = deck.isFirst;
    nextButton.disabled = deck.isLast;
    flipButton.textContent = deck.revealed ? "Hide answer" : "Show answer";
  };
  const flip = () => {
    deck.flip();
    card.setFlipped(deck.revealed);
    syncControls();
  };
  const showCurrent = () => {
    const current = deck.current;
    card = flipCard(markdown, current, `Lesson ${current.lessonId} · ${current.lessonTitle}`, () => {
      deck.flip();
      syncControls();
      return deck.revealed;
    });
    card.setFlipped(deck.revealed);
    stage.replaceChildren(card.root);
    syncControls();
  };
  const move = (step) => () => {
    step();
    showCurrent();
  };
  previousButton.addEventListener("click", move(() => deck.previous()));
  nextButton.addEventListener("click", move(() => deck.next()));
  shuffleButton.addEventListener("click", move(() => deck.shuffle()));
  flipButton.addEventListener("click", flip);
  const onKey = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowRight") move(() => deck.next())();
    else if (event.key === "ArrowLeft") move(() => deck.previous())();
    else if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      flip();
    }
  };
  document.addEventListener("keydown", onKey);
  ctx.onDispose(() => document.removeEventListener("keydown", onKey));

  showCurrent();
  page.append(
    stage,
    h("div", { class: "deck-controls" }, previousButton, flipButton, nextButton),
    h("div", { class: "deck-footer" }, position, shuffleButton),
    h("p", { class: "flashcards-hint" }, "Keys: Space flips the card, ← and → move between cards."),
  );
  return page;
}
