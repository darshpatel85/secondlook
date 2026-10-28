import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { run as runCommand } from "../lib/run.js";

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: "0" };
  if (config.githubToken) {
    const basic = Buffer.from(`x-access-token:${config.githubToken}`).toString("base64");
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
  }
  return env;
}

function run(command: string, args: string[], options: { cwd?: string } = {}): ReturnType<typeof runCommand> {
  return runCommand(command, args, { ...options, env: gitEnv() });
}

export function git(args: string[], cwd: string): ReturnType<typeof runCommand> {
  return run("git", args, { cwd });
}

export function clonePathFor(owner: string, name: string): string {
  return path.join(config.paths.repos, `${owner}__${name}`);
}

export async function cloneOrFetch(cloneUrl: string, dest: string): Promise<void> {
  if (fs.existsSync(path.join(dest, ".git"))) {
    await run("git", ["fetch", "--all", "--prune"], { cwd: dest });
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await run("git", ["clone", cloneUrl, dest]);
}

export async function detectDefaultBranch(clonePath: string): Promise<string> {
  try {
    const { stdout } = await run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: clonePath });
    return stdout.trim().replace(/^origin\//, "");
  } catch {
    return "main";
  }
}

export async function fetchPullRequest(clonePath: string, prNumber: number, baseRef: string): Promise<void> {
  await run(
    "git",
    [
      "fetch",
      "origin",
      `+refs/pull/${prNumber}/head:refs/remotes/origin/pr/${prNumber}`,
      `+refs/heads/${baseRef}:refs/remotes/origin/${baseRef}`,
    ],
    { cwd: clonePath },
  );
}

export async function ensureWorktree(clonePath: string, repoId: string, prNumber: number, headSha: string): Promise<string> {
  const dest = path.join(config.paths.worktrees, repoId, `pr-${prNumber}`);
  if (fs.existsSync(path.join(dest, ".git"))) {
    await run("git", ["checkout", "--detach", headSha], { cwd: dest });
    return dest;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await run("git", ["worktree", "prune"], { cwd: clonePath });
  await run("git", ["worktree", "add", "--detach", dest, headSha], { cwd: clonePath });
  return dest;
}

export type ChangedFile = { status: string; path: string };

export async function changedFiles(worktree: string, baseRef: string): Promise<ChangedFile[]> {
  const { stdout } = await run("git", ["diff", "--name-status", `origin/${baseRef}...HEAD`], { cwd: worktree });
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const status = parts[0] ?? "";
      const filePath = parts[parts.length - 1] ?? "";
      return { status, path: filePath };
    });
}
