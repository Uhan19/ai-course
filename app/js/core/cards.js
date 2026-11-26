export function keyConceptDeck(lessons) {
  return lessons.flatMap((lesson) =>
    (lesson.flashcards ?? [])
      .filter((card) => card.keyConcept)
      .map((card) => ({ ...card, lessonId: lesson.id, lessonTitle: lesson.title })),
  );
}

export class Deck {
  constructor(cards) {
    this.cards = cards;
    this.order = cards.map((_, position) => position);
    this.index = 0;
    this.revealed = false;
  }

  get current() {
    return this.cards[this.order[this.index]];
  }

  get position() {
    return this.index + 1;
  }

  get size() {
    return this.cards.length;
  }

  get isFirst() {
    return this.index === 0;
  }

  get isLast() {
    return this.index >= this.cards.length - 1;
  }

  flip() {
    this.revealed = !this.revealed;
  }

  next() {
    if (!this.isLast) this.moveTo(this.index + 1);
  }

  previous() {
    if (!this.isFirst) this.moveTo(this.index - 1);
  }

  shuffle(random = Math.random) {
    for (let last = this.order.length - 1; last > 0; last--) {
      const pick = Math.floor(random() * (last + 1));
      [this.order[last], this.order[pick]] = [this.order[pick], this.order[last]];
    }
    this.moveTo(0);
  }

  moveTo(index) {
    this.index = index;
    this.revealed = false;
  }
}

export function scoreCards(answers, total) {
  const marks = Array.from({ length: total }, (_, i) => (typeof answers?.[i] === "boolean" ? answers[i] : null));
  const answered = marks.filter((mark) => mark !== null).length;
  const score = marks.filter((mark) => mark === true).length;
  return { score, total, answered, complete: total > 0 && answered === total, answers: marks };
}

export function cardsVerdict({ score, total, complete }) {
  if (!complete) return "";
  if (score === total) return "You knew every card.";
  return `You knew ${score} of ${total}. The ones marked “Not yet” are worth another look.`;
}
