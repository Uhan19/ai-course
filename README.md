# AI, Under the Hood

An interactive course on how AI assistants work, for anyone who uses AI at work.
It is published as a Claude artifact, so learners open one link and can install it as a desktop app from the Claude desktop app.

Each lesson has a short plain-language explanation, a live playground, an x-ray of every request sent to Claude and every reply, optional "For engineers" sections, and a short quiz.

| # | Lesson |
|---|--------|
| 1 | What a model is: tokens, the context window, why answers vary |
| 2 | Prompting: the same request asked three ways |
| 3 | Chat is stateless: the whole history is resent every turn |
| 4 | Tools and agents: an editable agent loop |
| 5 | Context and memory: standing instructions, running out of room, summarizing |
| 6 | Grounding: answers with sources from a pasted document |
| 7 | Checking answers: simple evals, with Claude grading Claude |
| 8 | Real harnesses compared: Claude Code, Codex, Hermes Agent |
| 9 | Safety and cost: permissions, prompt injection, what usage costs |

## How it works

- Live calls use the artifact runtime's `sample` capability, so every call runs on the learner's own Claude account.
  No API key is embedded anywhere.
- Progress and quiz results are saved with the `db` capability under each learner's private `data/users/<id>/progress` document, using the id from the `user` capability.
- The `desktop` capability lets learners install the course as an app.
  The page asks for no desktop permissions (no files, terminal or processes).
- When a capability is missing (a viewer outside the organization, a signed-out viewer, a declined permission), every lesson still reads fine and the live parts show a short note instead.

## Layout

```
app/                 Everything that is published
  index.html         The page: styles, shell, and the desktop manifest tag
  js/app.js          Routing, home page, lesson frame
  js/runtime.js      Capability wiring: model calls with x-ray, progress store
  js/ui.js           DOM helpers, x-ray panel, quiz, playground pieces
  js/icon.js         Desktop app icon
  js/core/*.js       Pure logic with unit tests (tokens, x-ray, quiz, progress, ...)
  js/lessons/*.js    One module per lesson
dev/                 Local preview server and a fake Claude runtime
test/                Unit tests (node:test)
```

## Develop

```sh
npm test          # unit tests, no Artifact runtime needed
npm run preview   # http://localhost:8765/ ; add ?fake=ready or ?fake=declined
```

Without `?fake`, the preview behaves like a viewer with no Claude runtime.
With `?fake=ready`, a scripted fake answers every call and keeps progress in memory.

## Publish and update

The artifact is published privately with the Claude Code `Artifact` tool.
Always republish to the same artifact so the shared link keeps working:

- Artifact: https://claude.ai/artifact/NgziwPNw4FsEtb9ezTcZ9K
- Page: `app/index.html`
- Supporting files: every file under `app/js/`, published at the same relative path (for example `js/app.js`).
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

To update: edit files under `app/`, run `npm test`, check the preview, then ask Claude Code to republish `app/index.html` with all `app/js/` files to the artifact URL above.
Pass the capabilities only when they change; leaving them out keeps the stored ones.

Every example, name and document in the course is invented.
Lesson 8 and the pricing part of lesson 9 cite official sources with the date they were read; refresh them when updating those lessons.
