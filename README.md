# Primer

Primer is a small learning app for short, hands-on courses on any subject.
It is published as one Claude artifact, so learners open a link, or install it as a desktop app from the Claude desktop app.
The name lives in one place: the `<title>` at the top of `app/index.html`.

## Courses

| Course | Folder | Lessons |
|---|---|---|
| Build an agent harness | `app/courses/harness/` | 0 to 8, ported from `Uhan19/harness-course`: lessons 0 to 3 at `4ab3ac6`, lessons 4 to 8 at `34e23d5`. |

Each lesson has its text, a live **Try it** pane where it applies, and flashcards.
Marking each flashcard "I knew it" or "Not yet" finishes the lesson, and the result counts as the lesson's score.
Progress is saved privately per learner and shows on the home page.

## The harness course and its model

The harness lessons run a small TypeScript harness against a model and show every request and reply in an x-ray.
Learners can edit the harness files in the **Code** tab; their next chat message runs the edited code.

- **Local first.** In the installed desktop app, with the "full-access" permission, the page reaches the learner's own Ollama (`qwen3.5:9b` by default, and `qwen3.5:4b` for lesson 7) through the desktop child process API.
  When something is missing, the page shows the setup steps, such as `brew install ollama` and `ollama pull qwen3.5:9b`.
- **Claude as fallback.** Without the installed app, without the permission, without a ready local model, or when the learner picks it, calls go to Claude through the learner's own account (the `sample` capability).
  The page translates the harness's Ollama-shaped request for Claude and translates the reply back, and the x-ray says so at each step.
- **The sandbox.** From lesson 4 the agent's tools run in Docker, in the `python:3.13-alpine` image (about 74 MB), one fresh container per command.
  The page builds every `docker run` itself in `app/courses/harness/js/sandbox.js`: no network, user 1000, a read-only root, only `~/harness-course-workspace` mounted at `/workspace`, 1 CPU, 256 MB of memory, 64 processes, and a 10-second timeout.
  Harness code only names the command to run inside the container; it can lower the timeout and output limit but never raise them or change a flag.
  The page creates the workspace folder with the files in `workspace-seed/` the first time, and **Reset files** moves it to the Trash and puts them back.
  When Docker is missing or stopped, or the image isn't pulled, the page shows the setup steps, such as `brew install --cask docker-desktop`, `open -a Docker` and `docker pull python:3.13-alpine`.
- **The simulated sandbox.** Without the local model, without the permission, without Docker, or with Claude as the model, the page simulates the sandbox instead: a copy of the workspace files in the page and a small stand-in for the simple commands listed in `SUPPORTED` in `app/courses/harness/js/simulated-sandbox.js`, such as `ls`, `cat` and `grep`.
  Any other command, Python included, exits with code 127 and a message that it needs the real Docker sandbox in the installed app, and the suggestions that need Python say so while the sandbox is simulated.
  Every simulated step is labelled **Simulated sandbox** in the x-ray, and nothing runs on the learner's computer.
- **Isolation.** Harness code, including learner edits, is compiled in the browser with TypeScript and runs in a Web Worker.
  The worker has no desktop access: no `childProcess`, `fs`, `pty` or `shell`.
  Its `fetch` reaches only the Ollama endpoints below through the page, and `coursePage` lets it ask the page to prepare the sandbox, run one command in it, or read one file at the top of the workspace, never through a link.
- **The fixed commands.** These are all the page runs on the learner's computer:
  - `curl` to Ollama's chat, tags and version endpoints at `127.0.0.1:11434`, and `command -v ollama || test -d /Applications/Ollama.app` to see whether Ollama is installed.
  - `command -v docker`, with the usual Docker install folders added to `PATH`, to find Docker.
  - `docker info --format {{.ServerVersion}}` to see whether Docker is running, and `docker image inspect --format {{.Id}} python:3.13-alpine` to see whether the image is pulled.
  - `docker run` with the locks above, then the command the harness asked for, and `docker kill harness-sandbox-<id>` when that command passes its timeout.
  - File reads and writes only inside `~/harness-course-workspace`, opening that folder on **Open folder**, and moving it to the Trash on **Reset files**.

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
    workspace-seed/       The sandbox workspace's starting files, including the AGENTS.md project notes
    js/sandbox.js         The locked docker command, Docker checks and the workspace folder
    js/simulated-sandbox.js  The in-page stand-in used when Docker can't be
dev/serve.mjs             Local preview server
dev/fake-claude.js        Scripted capabilities for the preview
dev/node-desktop.mjs      The desktop API on Node, for the e2e script and the Docker tests
dev/e2e-local.mjs         Runs a harness lesson against your real local Ollama, and Docker from lesson 4
test/                     Unit tests (node:test)
test-docker/              Checks the real sandbox's locks; needs Docker
```

## Add a course

1. Create `app/courses/<id>/course.js` exporting `{ id, title, summary, lessons, renderLesson(lesson, ctx) }`.
   Each lesson needs an `id`, `title`, `summary` and optional `flashcards` (`{ front, back, keyConcept }`).
   `ctx` gives the course `runtime`, `markdown`, `replyMarkdown` (for untrusted text such as model replies), `flashcards(lesson)`, `pager(lesson)`, `watch(fn)` and `onDispose(fn)`.
2. Add it to `COURSES` in `app/courses/index.js`.
3. Add its files to the publish list below.

The shell, home page, progress and flashcards need no changes.

## Develop

```sh
npm install                       # TypeScript and marked, used by the tests
npm test                          # unit tests; no Artifact runtime, Ollama or Docker needed
npm run test:docker               # runs real commands in the real sandbox and proves the locks hold
npm run preview                   # http://127.0.0.1:8765/
node dev/e2e-local.mjs 3          # drive lesson 3 against your local Ollama
node dev/e2e-local.mjs 4 "Run hello.py"   # drive lesson 4 against Ollama and Docker
```

The preview, the e2e script and `test:docker` use `dev/.preview-home/` as the home folder, so they never touch your own `~/harness-course-workspace`.

Preview modes: no query string behaves like a viewer with no Claude runtime.
`?fake=local` acts as the installed app with full access, sending its fixed commands to your real Ollama and Docker through the preview server, which accepts only those commands.
`?fake=local-nodocker` is the same, but as if Docker were not installed.
`?fake=local-ask` starts with the permission not yet granted, `?fake=fallback` uses scripted Claude replies, `?fake=declined` declines Claude, and `?fake=none` has neither.

## Publish and update

Publish privately with the Claude Code `Artifact` tool, always to the same artifact so the shared link keeps working:

- Artifact: https://claude.ai/artifact/NgziwPNw4FsEtb9ezTcZ9K
- Page: `app/index.html`
- Supporting files: every other file under `app/`, at its path relative to `app/` (for example `js/app.js`, `courses/harness/lessons/00-what-is-a-harness.md`).
  Publish `.ts`, `.py` and `.txt` files with content type `text/plain` and `.md` files with `text/markdown`.
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
