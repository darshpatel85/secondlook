import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-review-doc-edits-"));
process.env.AI_REVIEW_DATA_DIR = dataDir;
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
});

const { openDb } = await import("../db/client.js");
const { docEdits, repos, reviews } = await import("../db/schema.js");
const { HttpError } = await import("../lib/http-error.js");
const { newId } = await import("../lib/ids.js");
const { run } = await import("../lib/run.js");
const { docsBranchName, listDocEdits, openDocsPr, setDocEditStatus } = await import("./doc-edits.js");
type DocEditDeps = import("./doc-edits.js").DocEditDeps;

const git = (args: string[], cwd: string) => run("git", args, { cwd });

const bare = path.join(dataDir, "origin.git");
const clone = path.join(dataDir, "clone");

async function seedOrigin(): Promise<void> {
  await run("git", ["init", "--bare", "--initial-branch=main", bare]);
  const seed = path.join(dataDir, "seed");
  await run("git", ["clone", "--quiet", bare, seed]);
  await fs.mkdir(path.join(seed, "docs"), { recursive: true });
  await fs.writeFile(path.join(seed, "docs", "guide.md"), "# Guide\n\nOld line.\n", "utf8");
  await fs.writeFile(path.join(seed, "README.md"), "# Repo\n", "utf8");
  await git(["add", "-A"], seed);
  await git(["commit", "--quiet", "-m", "seed\n\nCo-Authored-By: Example Bot <bot@example.com>"], seed);
  await git(["push", "--quiet", "origin", "main"], seed);
  await run("git", ["clone", "--quiet", bare, clone]);
}

const guideDiff = `--- a/docs/guide.md
+++ b/docs/guide.md
@@ -1,3 +1,3 @@
 # Guide

-Old line.
+New line from review.
`;

const brokenDiff = `--- a/docs/guide.md
+++ b/docs/guide.md
@@ -1,3 +1,3 @@
 # Guide

-This text was never there.
+Something else.
`;

type Db = ReturnType<typeof openDb>;

function insertRepo(db: Db, overrides: Partial<typeof repos.$inferInsert> = {}) {
  return db
    .insert(repos)
    .values({
      id: newId(),
      owner: "acme",
      name: "widgets",
      cloneUrl: bare,
      defaultBranch: "main",
      kind: "backend",
      skillPath: "/skills/review.md",
      docsPaths: ["docs"],
      clonePath: clone,
      cloneState: "ready",
      ...overrides,
    })
    .returning()
    .get();
}

function insertReview(db: Db, repoId: string) {
  return db
    .insert(reviews)
    .values({
      id: newId(),
      repoId,
      prNumber: 7,
      prUrl: "https://github.com/acme/widgets/pull/7",
      title: "Add widget export",
      headRef: "feature/export",
      baseRef: "main",
      headSha: "abc123",
      phase: "done",
      sessionId: newId(),
    })
    .returning()
    .get();
}

function insertEdit(db: Db, repoId: string, reviewId: string | null, diff: string, status: "proposed" | "approved" = "approved", at = new Date()) {
  return db
    .insert(docEdits)
    .values({ id: newId(), repoId, reviewId, path: "docs/guide.md", diff, rationale: "Keep the guide current", status, createdAt: at })
    .returning()
    .get();
}

async function expectHttpError(promise: Promise<unknown> | (() => unknown), status: number): Promise<InstanceType<typeof HttpError>> {
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (error) {
    assert.ok(error instanceof HttpError, `expected HttpError, got ${String(error)}`);
    assert.equal(error.statusCode, status);
    return error;
  }
  assert.fail(`expected HttpError ${status}`);
}

describe("doc edits", () => {
  before(seedOrigin);
  after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("docsBranchName uses the yyyymmdd-hhmm stamp", () => {
    assert.equal(docsBranchName(new Date(2026, 9, 3, 14, 7)), "docs/review-updates-20261003-1407");
  });

  it("lists edits newest first and only for the repo", () => {
    const db = openDb(":memory:");
    const repo = insertRepo(db);
    const other = insertRepo(db, { name: "other" });
    const older = insertEdit(db, repo.id, null, guideDiff, "proposed", new Date(1000));
    const newer = insertEdit(db, repo.id, null, guideDiff, "proposed", new Date(2000));
    insertEdit(db, other.id, null, guideDiff);
    assert.deepEqual(
      listDocEdits(db, repo.id).map((edit) => edit.id),
      [newer.id, older.id],
    );
  });

  it("approves and discards, clearing any earlier error, and refuses to touch opened edits", async () => {
    const db = openDb(":memory:");
    const repo = insertRepo(db);
    const edit = insertEdit(db, repo.id, null, guideDiff, "proposed");
    db.update(docEdits).set({ error: "did not apply" }).where(eq(docEdits.id, edit.id)).run();
    const approved = setDocEditStatus(db, repo.id, edit.id, "approved");
    assert.equal(approved.status, "approved");
    assert.equal(approved.error, null);
    assert.equal(setDocEditStatus(db, repo.id, edit.id, "discarded").status, "discarded");
    db.update(docEdits).set({ status: "opened" }).where(eq(docEdits.id, edit.id)).run();
    await expectHttpError(() => setDocEditStatus(db, repo.id, edit.id, "approved"), 409);
    await expectHttpError(() => setDocEditStatus(db, repo.id, "nope", "approved"), 404);
  });

  it("openDocsPr returns 409 when nothing is approved", async () => {
    const db = openDb(":memory:");
    const repo = insertRepo(db);
    insertEdit(db, repo.id, null, guideDiff, "proposed");
    await expectHttpError(openDocsPr(db, repo.id), 409);
  });

  it("openDocsPr applies approved edits on a new branch, pushes it, opens a PR and marks edits opened", async () => {
    const db = openDb(":memory:");
    const repo = insertRepo(db);
    const review = insertReview(db, repo.id);
    const good = insertEdit(db, repo.id, review.id, guideDiff, "approved", new Date(1000));
    const bad = insertEdit(db, repo.id, null, brokenDiff, "approved", new Date(2000));
    const created: Array<Parameters<DocEditDeps["createPullRequest"]>[0]> = [];
    const deps: DocEditDeps = {
      git,
      createPullRequest: async (input) => {
        created.push(input);
        return "https://github.com/acme/widgets/pull/99";
      },
      now: () => new Date(2026, 9, 3, 9, 5),
    };

    const result = await openDocsPr(db, repo.id, deps);
    assert.equal(result.prUrl, "https://github.com/acme/widgets/pull/99");

    const branch = "docs/review-updates-20261003-0905";
    const pr = created[0];
    assert.ok(pr);
    assert.equal(pr.head, branch);
    assert.equal(pr.base, "main");
    assert.equal(pr.owner, "acme");
    assert.equal(pr.repo, "widgets");
    assert.match(pr.body, /docs\/guide\.md/);
    assert.match(pr.body, /Keep the guide current/);
    assert.match(pr.body, /https:\/\/github\.com\/acme\/widgets\/pull\/7/);

    const { stdout: content } = await git(["show", `${branch}:docs/guide.md`], bare);
    assert.equal(content, "# Guide\n\nNew line from review.\n");
    const { stdout: subject } = await git(["log", "-1", "--format=%B", branch], bare);
    assert.match(subject, /^docs: updates from code review\n\nCo-Authored-By: Example Bot <bot@example.com>/);
    const { stdout: count } = await git(["rev-list", "--count", `main..${branch}`], bare);
    assert.equal(count.trim(), "1");
    const { stdout: mainHead } = await git(["rev-parse", "main"], bare);
    const { stdout: branchParent } = await git(["rev-parse", `${branch}^`], bare);
    assert.equal(mainHead, branchParent);

    const goodRow = db.select().from(docEdits).where(eq(docEdits.id, good.id)).get();
    assert.equal(goodRow?.status, "opened");
    const badRow = db.select().from(docEdits).where(eq(docEdits.id, bad.id)).get();
    assert.equal(badRow?.status, "proposed");
    assert.match(badRow?.error ?? "", /apply/);
  });

  it("openDocsPr leaves everything in the queue when no edit applies", async () => {
    const db = openDb(":memory:");
    const repo = insertRepo(db);
    const bad = insertEdit(db, repo.id, null, brokenDiff, "approved");
    const deps: DocEditDeps = {
      git,
      createPullRequest: async () => assert.fail("no PR expected"),
      now: () => new Date(2026, 9, 3, 9, 6),
    };
    await expectHttpError(openDocsPr(db, repo.id, deps), 409);
    const row = db.select().from(docEdits).where(eq(docEdits.id, bad.id)).get();
    assert.equal(row?.status, "proposed");
    assert.ok(row?.error);
    const { stdout } = await git(["branch", "--list", "docs/review-updates-20261003-0906"], clone);
    assert.equal(stdout.trim(), "");
  });
});
