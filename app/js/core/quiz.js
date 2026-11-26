export function scoreQuiz(questions, answers) {
  const results = questions.map((question, i) => {
    const chosen = Number.isInteger(answers?.[i]) ? answers[i] : null;
    return { chosen, answer: question.answer, correct: chosen === question.answer };
  });
  const score = results.filter((r) => r.correct).length;
  return { score, total: questions.length, results, complete: results.every((r) => r.chosen !== null) };
}

export function quizVerdict({ score, total }) {
  if (total === 0) return "";
  if (score === total) return "All correct.";
  if (score / total >= 0.5) return "Nice work. Read the notes on the ones you missed.";
  return "Worth another look. The notes under each question explain the answer.";
}
