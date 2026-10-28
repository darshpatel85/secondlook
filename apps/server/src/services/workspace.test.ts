import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { CommandError } from "../lib/run.js";
import { prepareWorkspace, type WorkspaceDeps } from "./workspace.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-workspace-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

function makeDir(name: string, files: string[] = []): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) fs.mkdirSync(path.join(dir, file), { recursive: true });
  return dir;
}

type Call = { command: string; args: string[]; cwd: string | undefined };

function fakeDeps(fail: (call: Call) => boolean = () => false): { deps: WorkspaceDeps; calls: Call[] } {
  const calls: Call[] = [];
  const deps: WorkspaceDeps = {
    run: async (command, args, options = {}) => {
      const call = { command, args, cwd: options.cwd };
      calls.push(call);
      if (fail(call)) throw new CommandError(`${command} ${args.join(" ")}`, 1, "boom");
      return { stdout: "", stderr: "" };
    },
  };
  return { deps, calls };
}

describe("prepareWorkspace", () => {
  it("pulls every related repo and runs yarn install in a worktree with a yarn.lock", async () => {
    const related = makeDir("related-ok", [".git"]);
    const worktree = makeDir("worktree-yarn");
    fs.writeFileSync(path.join(worktree, "yarn.lock"), "");
    const { deps, calls } = fakeDeps();

    const warnings = await prepareWorkspace(worktree, [related], deps);

    assert.deepEqual(warnings, []);
    assert.deepEqual(
      calls.map(({ command, args, cwd }) => ({ command, args, cwd })),
      [
        { command: "git", args: ["pull", "--ff-only"], cwd: related },
        { command: "yarn", args: ["install"], cwd: worktree },
      ],
    );
  });

  it("skips yarn install when the worktree has no yarn.lock", async () => {
    const worktree = makeDir("worktree-plain");
    const { deps, calls } = fakeDeps();

    assert.deepEqual(await prepareWorkspace(worktree, [], deps), []);
    assert.equal(calls.length, 0);
  });

  it("turns failures into warnings instead of throwing", async () => {
    const broken = makeDir("related-broken", [".git"]);
    const notGit = makeDir("related-not-git");
    const worktree = makeDir("worktree-broken");
    fs.writeFileSync(path.join(worktree, "yarn.lock"), "");
    const { deps } = fakeDeps(() => true);

    const warnings = await prepareWorkspace(worktree, [broken, notGit], deps);

    assert.equal(warnings.length, 3);
    assert.match(warnings[0] ?? "", /Could not pull related repo .*related-broken/);
    assert.match(warnings[1] ?? "", /related-not-git is not a git checkout/);
    assert.match(warnings[2] ?? "", /yarn install failed/);
  });
});
