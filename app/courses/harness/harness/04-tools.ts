import { LIMITS, runInSandbox } from "./04-sandbox.ts";
import type { Tool } from "./03-tools.ts";
import type { SandboxRun } from "./types.ts";

// Lesson 4: real tools. Every one of them runs inside the Docker sandbox, never on your Mac.
export const SANDBOX_TOOLS: Tool[] = [
  {
    name: "list_files",
    description: "List the files in a folder of the workspace, with sizes.",
    parameters: {
      path: { type: "string", description: "Folder to list, relative to the workspace. Leave out for the workspace itself." },
    },
    required: [],
    async run(args, xray) {
      const run = await runInSandbox(["ls", "-la", "--", pathArg(args.path, ".")], xray);
      return outputOrThrow(run);
    },
  },
  {
    name: "read_file",
    description: "Read a text file from the workspace.",
    parameters: {
      path: { type: "string", description: "File to read, relative to the workspace. Example: hello.py" },
    },
    required: ["path"],
    async run(args, xray) {
      const run = await runInSandbox(["cat", "--", pathArg(args.path)], xray);
      return outputOrThrow(run);
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a text file in the workspace.",
    parameters: {
      path: { type: "string", description: "File to write, relative to the workspace. Example: notes/todo.txt" },
      content: { type: "string", description: "The full new content of the file." },
    },
    required: ["path", "content"],
    async run(args, xray) {
      const path = pathArg(args.path);
      const content = String(args.content ?? "");
      const run = await runInSandbox(["sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", path], xray, content);
      outputOrThrow(run);
      return `Wrote ${content.length} characters to ${path}.`;
    },
  },
  {
    name: "run_command",
    description: "Run a shell command in the workspace and get its output and exit code. The sandbox has python3 but no internet.",
    parameters: {
      command: { type: "string", description: "The shell command. Example: python3 hello.py" },
    },
    required: ["command"],
    async run(args, xray) {
      const run = await runInSandbox(["sh", "-c", String(args.command ?? "")], xray);
      return describeCommand(run);
    },
  },
];

function pathArg(value: unknown, fallback?: string): string {
  const path = typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
  if (path === undefined) throw new Error("A path is required.");
  return path;
}

// File tools treat a failed command as an error, so the model sees "Error: ..." just like in lesson 3.
function outputOrThrow(run: SandboxRun): string {
  if (run.timedOut) throw new Error(`The command was stopped after ${LIMITS.timeoutMs / 1000} s.`);
  if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `The command failed with exit code ${run.exitCode}.`);
  return run.stdout;
}

// A shell command that fails is still a normal result: the model needs the exit code and the error text.
function describeCommand(run: SandboxRun): string {
  if (run.timedOut) return `Timed out: the command was stopped after ${LIMITS.timeoutMs / 1000} s.\n${run.stdout}${run.stderr}`.trim();
  const parts = [`Exit code: ${run.exitCode}`];
  if (run.stdout) parts.push(`Output:\n${run.stdout}`);
  if (run.stderr) parts.push(`Errors:\n${run.stderr}`);
  return parts.join("\n");
}
