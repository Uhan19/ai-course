# Primer

Primer is a small learning app for short, hands-on courses on any subject.
It is published as one Claude artifact, so learners open a link, or install it as a desktop app from the Claude desktop app.
The name lives in one place: the `<title>` at the top of `app/index.html`.

## Courses

| Course | Folder | Lessons |
|---|---|---|
| Build an agent harness | `app/courses/harness/` | 0 to 3, ported from `Uhan19/harness-course` at `4ab3ac6`. Lessons 4 to 8 follow once they land on its `main`. |

Each lesson has its text, a live **Try it** pane where it applies, and flashcards.
Marking each flashcard "I knew it" or "Not yet" finishes the lesson, and the result counts as the lesson's score.
Progress is saved privately per learner and shows on the home page.

## The harness course and its model

The harness lessons run a small TypeScript harness against a model and show every request and reply in an x-ray.
Learners can edit the harness files in the **Code** tab; their next chat message runs the edited code.

- **Local first.** In the installed desktop app, with the "full-access" permission, the page reaches the learner's own Ollama (`qwen3.5:9b` by default) through the desktop child process API.
  It runs only fixed commands: `curl` to Ollama's chat, tags and version endpoints at `127.0.0.1:11434`, and a check that Ollama is installed.
  When something is missing, the page shows the setup steps, such as `brew install ollama` and `ollama pull qwen3.5:9b`.
- **Claude as fallback.** Without the installed app, without the permission, without a ready local model, or when the learner picks it, calls go to Claude through the learner's own account (the `sample` capability).
  The page translates the harness's Ollama-shaped request for Claude and translates the reply back, and the x-ray says so at each step.
- **Isolation.** Harness code, including learner edits, is compiled in the browser with TypeScript and runs in a Web Worker.
  The worker has no desktop access; its `fetch` reaches only those Ollama endpoints through the page.

## Layout

```
app/                      Everything that is published
  index.html              Page: name, styles, shell, desktop permission manifest
  js/app.js               Routing, home page, lesson frame
  js/runtime.js           Capability wiring: Claude calls, desktop, install, progress store
  js/flashcards.js        Lesson flashcards with saved scores, and the review deck
  js/core/*.js            Pure logic: progress, flashcard decks, markdown flow diagrams
  courses/index.js        The course registry
  courses/harness/        Course 1: lesson text, harness files, and its own UI and adapters
dev/serve.mjs             Local preview server
dev/fake-claude.js        Scripted capabilities for the preview
dev/e2e-local.mjs         Runs a harness lesson against your real local Ollama
test/                     Unit tests (node:test)
```

## Add a course

1. Create `app/courses/<id>/course.js` exporting `{ id, title, summary, lessons, renderLesson(lesson, ctx) }`.
   Each lesson needs an `id`, `title`, `summary` and optional `flashcards` (`{ front, back, keyConcept }`).
   `ctx` gives the course `runtime`, `markdown`, `flashcards(lesson)`, `pager(lesson)`, `watch(fn)` and `onDispose(fn)`.
2. Add it to `COURSES` in `app/courses/index.js`.
3. Add its files to the publish list below.

The shell, home page, progress and flashcards need no changes.

## Develop

```sh
npm install                       # TypeScript and marked, used by the tests
npm test                          # unit tests; no Artifact runtime or Ollama needed
npm run preview                   # http://127.0.0.1:8765/
node dev/e2e-local.mjs 3          # drive lesson 3 against your local Ollama
```

Preview modes: no query string behaves like a viewer with no Claude runtime.
`?fake=local` acts as the installed app with full access, sending its fixed commands to your real Ollama through the preview server.
`?fake=local-ask` starts with the permission not yet granted, `?fake=fallback` uses scripted Claude replies, `?fake=declined` declines Claude, and `?fake=none` has neither.

## Publish and update

Publish privately with the Claude Code `Artifact` tool, always to the same artifact so the shared link keeps working:

- Artifact: https://claude.ai/artifact/NgziwPNw4FsEtb9ezTcZ9K
- Page: `app/index.html`
- Supporting files: every other file under `app/`, at its path relative to `app/` (for example `js/app.js`, `courses/harness/lessons/00-what-is-a-harness.md`).
  Publish `.ts` files with content type `text/plain` and `.md` files with `text/markdown`.
- Capabilities:

```json
{
  "sample": {},
  "user": {},
  "desktop": {},
  "db": {
    "rules": [
      { "path": "", "read": "admin", "write": "admin" },
      { "path": "data/users/{self}", "read": "interact", "write": "interact" }
    ]
  }
}
```

To update: edit files under `app/`, run `npm test`, check the preview, then republish `app/index.html` with all supporting files to the artifact above.
Leave capabilities out when they don't change; the stored ones are kept.
Remove a deleted file from the artifact by publishing its path as `null`.

Every example in the courses is invented; nothing comes from a real company or person.
