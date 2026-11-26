export const PROGRESS_VERSION = 1;

export function emptyProgress() {
  return { version: PROGRESS_VERSION, lessons: {} };
}

export function normalizeProgress(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.lessons !== "object" || raw.lessons === null) {
    return emptyProgress();
  }
  const lessons = {};
  for (const [id, entry] of Object.entries(raw.lessons)) {
    if (entry && typeof entry === "object") lessons[id] = { ...entry };
  }
  return { version: PROGRESS_VERSION, lessons };
}

export function markVisited(progress, lessonId, now = Date.now()) {
  const current = progress.lessons[lessonId];
  if (current?.visitedAt) return progress;
  return withLesson(progress, lessonId, { ...current, visitedAt: now });
}

export function recordQuiz(progress, lessonId, { score, total, answers }, now = Date.now()) {
  const current = progress.lessons[lessonId] ?? {};
  const best = Math.max(score, current.quiz?.best ?? 0);
  return withLesson(progress, lessonId, {
    ...current,
    visitedAt: current.visitedAt ?? now,
    completedAt: current.completedAt ?? now,
    quiz: { score, total, best, answers: [...answers], takenAt: now },
  });
}

function withLesson(progress, lessonId, entry) {
  return { ...progress, lessons: { ...progress.lessons, [lessonId]: entry } };
}

export function lessonStatus(progress, lessonId) {
  const entry = progress.lessons[lessonId];
  if (entry?.completedAt) return "done";
  if (entry?.visitedAt) return "started";
  return "new";
}

export function progressSummary(progress, lessonIds) {
  const done = lessonIds.filter((id) => lessonStatus(progress, id) === "done").length;
  const total = lessonIds.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

export function nextLessonId(progress, lessonIds) {
  return lessonIds.find((id) => lessonStatus(progress, id) !== "done") ?? null;
}

export function mergeProgress(remote, local) {
  const merged = { ...remote.lessons };
  for (const [id, mine] of Object.entries(local.lessons)) {
    merged[id] = mergeLesson(merged[id], mine);
  }
  return { version: PROGRESS_VERSION, lessons: merged };
}

function mergeLesson(theirs, mine) {
  if (!theirs) return mine;
  const quiz = latest(theirs.quiz, mine.quiz);
  const best = Math.max(theirs.quiz?.best ?? 0, mine.quiz?.best ?? 0);
  const entry = {
    ...theirs,
    ...mine,
    visitedAt: earliest(theirs.visitedAt, mine.visitedAt),
    completedAt: earliest(theirs.completedAt, mine.completedAt),
  };
  if (quiz) entry.quiz = { ...quiz, best };
  else delete entry.quiz;
  for (const key of ["visitedAt", "completedAt"]) if (entry[key] === undefined) delete entry[key];
  return entry;
}

function earliest(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function latest(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (b.takenAt ?? 0) >= (a.takenAt ?? 0) ? b : a;
}

export function sameProgress(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
