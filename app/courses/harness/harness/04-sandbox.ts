import type { SandboxRequest, SandboxRun, XRay } from "./types.ts";

// The page runs the sandbox for the harness. It builds the docker command itself, with locks harness code cannot change.
declare const coursePage: {
  prepareSandbox(): Promise<void>;
  runInSandbox(request: SandboxRequest): Promise<SandboxRun>;
  readWorkspaceFile(name: string): Promise<string>;
};

// The page never lets a command run longer than 10 s, or send back more than 8,000 characters. You can only lower them.
export const LIMITS = {
  timeoutMs: 10_000,
};

// Long output would flood the model's context, so the harness keeps only the start.
export const MAX_OUTPUT_CHARS = 8_000;

// Run one command in a fresh locked container. It never runs on your computer directly.
export async function runInSandbox(command: string[], xray: XRay, stdin?: string): Promise<SandboxRun> {
  const run = await coursePage.runInSandbox({ command, stdin, timeoutMs: LIMITS.timeoutMs, maxOutputChars: MAX_OUTPUT_CHARS });
  xray.sandbox(run, describeRun(run));
  return run;
}

function describeRun(run: SandboxRun): string {
  const where = run.simulated ? "Simulated the command in this page, not in Docker." : "Ran the command in a fresh locked container.";
  if (run.timedOut) return `${where} It ran past the ${LIMITS.timeoutMs / 1000} s limit, so it was stopped.`;
  if (run.exitCode === 0) return `${where} It finished normally (exit code 0).`;
  return `${where} It failed with exit code ${run.exitCode}.`;
}

// Checked before every turn: the page makes sure the workspace folder exists and picks Docker or its simulation.
export async function ensureSandboxReady(): Promise<void> {
  await coursePage.prepareSandbox();
}

// Read a file from the workspace for the harness itself, outside the sandbox. The page never follows a link.
export function readWorkspaceFile(name: string): Promise<string> {
  return coursePage.readWorkspaceFile(name);
}
