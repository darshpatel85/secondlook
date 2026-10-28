import fs from "node:fs";
import path from "node:path";
import { run } from "../lib/run.js";

export type WorkspaceDeps = { run: typeof run };

const defaultDeps: WorkspaceDeps = { run };

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

export async function pullRelatedRepo(dir: string, deps: WorkspaceDeps = defaultDeps): Promise<string | null> {
  if (!fs.existsSync(path.join(dir, ".git"))) return `Related repo ${dir} is not a git checkout, so it was not pulled.`;
  try {
    await deps.run("git", ["pull", "--ff-only"], { cwd: dir, env: { GIT_TERMINAL_PROMPT: "0" } });
    return null;
  } catch (error) {
    return `Could not pull related repo ${dir}, so it may be out of date: ${describe(error)}`;
  }
}

export async function installDependencies(worktree: string, deps: WorkspaceDeps = defaultDeps): Promise<string | null> {
  if (!fs.existsSync(path.join(worktree, "yarn.lock"))) return null;
  try {
    await deps.run("yarn", ["install"], { cwd: worktree });
    return null;
  } catch (error) {
    return `yarn install failed in the pull request checkout, so node_modules may be missing or stale: ${describe(error)}`;
  }
}

export async function prepareWorkspace(worktree: string, relatedPaths: string[], deps: WorkspaceDeps = defaultDeps): Promise<string[]> {
  const results = await Promise.all([...relatedPaths.map((dir) => pullRelatedRepo(dir, deps)), installDependencies(worktree, deps)]);
  return results.filter((warning): warning is string => warning !== null);
}
