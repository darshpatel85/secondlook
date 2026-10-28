import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { openDb, type Db } from "../db/client.js";
import { contextGaps, findings, repos, reviews, stepFiles, steps, type Repo, type Review } from "../db/schema.js";
import { bus, type ReviewEvent } from "../events/bus.js";
import { HttpError } from "../lib/http-error.js";
import { newId } from "../lib/ids.js";
import { CommandError } from "../lib/run.js";
import type { AgentManager } from "./agent/contracts.js";
import type { PullRequestInfo } from "./github.js";
import {
  addReviewerFinding,
  answerGap,
  autoConfirmContext,
  completeContext,
  continueUpfrontReview,
  createReview,
  decideApproach,
  detectFigmaUrl,
  detectJiraKey,
  fileContent,
  fileDiff,
  prepareReview,
  rerunStep,
  syncPullRequest,
  sendChat,
  setFileState,
  updateFinding,
  type ReviewDeps,
} from "./review.js";

class FakeAgentManager implements AgentManager {
  readonly sent: string[] = [];
  readonly started: string[] = [];
  running = false;
  startError: Error | null = null;

  async ensureStarted(review: Review): Promise<void> {
    if (this.startError) throw this.startError;
    this.started.push(review.id);
    this.running = true;
  }

  send(_reviewId: string, text: string): void {
    this.sent.push(text);
  }

  isBusy(): boolean {
    return false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async stop(): Promise<void> {
    this.running = false;
  }
}

const samplePr: PullRequestInfo = {
  title: "Add widget export",
  body: "Implements the CSV export.\n\nDesign: https://www.figma.com/design/abc/Widgets?node-id=1-2\n",
  author: "octocat",
  headRef: "feature/WID-1234-widget-export",
  baseRef: "dev",
  headSha: "abc123",
};

type Harness = { db: Db; agent: FakeAgentManager; deps: ReviewDeps; events: ReviewEvent[]; pr: PullRequestInfo };

function makeDeps(agent: FakeAgentManager, pr: PullRequestInfo): ReviewDeps {
  return {
    agentManager: agent,
    getPullRequest: async () => pr,
    fetchPullRequest: async () => {},
    ensureWorktree: async (_clonePath, repoId, prNumber) => path.join(os.tmpdir(), "ai-review-worktree", repoId, `pr-${prNumber}`),
    loadPromptContext: async (repo, review, gaps) => ({ repo, review, gaps, skill: "Review well.", docs: [], memory: "", integrations: [] }),
    changedFiles: async () => [{ status: "M", path: "src/export.ts" }],
    run: async (_cmd, args) => {
      if (args[0] === "show" && args[1]?.endsWith("missing.ts")) throw new CommandError("git show", 128, "does not exist");
      return { stdout: `out:${args.join(" ")}`, stderr: "" };
    },
    prepareWorkspace: async () => [],
  };
}

function insertRepo(db: Db, overrides: Partial<typeof repos.$inferInsert> = {}): Repo {
  return db
    .insert(repos)
    .values({
      id: newId(),
      owner: "acme",
      name: "widgets",
      cloneUrl: "https://github.com/acme/widgets",
      defaultBranch: "dev",
      kind: "backend",
      skillPath: "/skills/review.md",
      docsPaths: ["docs"],
      clonePath: "/tmp/acme__widgets",
      cloneState: "ready",
      ...overrides,
    })
    .returning()
    .get();
}

function insertReview(db: Db, repo: Repo, overrides: Partial<typeof reviews.$inferInsert> = {}): Review {
  return db
    .insert(reviews)
    .values({
      id: newId(),
      repoId: repo.id,
      prNumber: 7,
      prUrl: "https://github.com/acme/widgets/pull/7",
      title: "Add widget export",
      headRef: "feature/export",
      baseRef: "dev",
      headSha: "abc123",
      phase: "context",
      sessionId: newId(),
      worktreePath: "/tmp/worktree",
      ...overrides,
    })
    .returning()
    .get();
}

function harness(pr: PullRequestInfo = samplePr): Harness {
  const db = openDb(":memory:");
  const agent = new FakeAgentManager();
  const events: ReviewEvent[] = [];
  return { db, agent, deps: makeDeps(agent, pr), events, pr };
}

function watch(t: TestContext, events: ReviewEvent[], reviewId: string): void {
  t.after(bus.subscribe(reviewId, (event) => events.push(event)));
}

async function expectHttpError(promise: Promise<unknown> | (() => unknown), status: number): Promise<HttpError> {
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (error) {
    assert.ok(error instanceof HttpError, `expected an HttpError, got ${String(error)}`);
    assert.equal(error.statusCode, status, error.message);
    return error;
  }
  assert.fail(`expected HttpError ${status}`);
}

async function waitFor<T>(read: () => T | undefined, label: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const reviewRow = (db: Db, id: string): Review => db.select().from(reviews).where(eq(reviews.id, id)).get() as Review;

describe("review service", () => {
  let previousReviewsDir: string;

  before(() => {
    previousReviewsDir = config.paths.reviews;
    config.paths.reviews = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-reviews-"));
  });

  after(() => {
    fs.rmSync(config.paths.reviews, { recursive: true, force: true });
    config.paths.reviews = previousReviewsDir;
  });

  describe("detection", () => {
    it("finds the first Jira key across sources in order", () => {
      assert.equal(detectJiraKey("feature/WID-12-thing", "ABC-9 title", null), "WID-12");
      assert.equal(detectJiraKey("feature/no-key", "Fix ABC-9 crash", "DEF-1"), "ABC-9");
      assert.equal(detectJiraKey("feature/no-key", "no key here", "see DEF-1"), "DEF-1");
      assert.equal(detectJiraKey("feature/x", "lowercase abc-9", "UUID-like a1b2-3 no"), null);
    });

    it("finds a Figma URL with or without www", () => {
      assert.equal(detectFigmaUrl("see https://figma.com/file/xyz/Thing?node=1 and more"), "https://figma.com/file/xyz/Thing?node=1");
      assert.equal(detectFigmaUrl("(https://www.figma.com/design/abc)"), "https://www.figma.com/design/abc");
      assert.equal(detectFigmaUrl("nothing"), null);
      assert.equal(detectFigmaUrl(null), null);
    });
  });

  describe("createReview", () => {
    it("rejects a URL that is not a pull request", async (t) => {
      const { db, deps } = harness();
      await expectHttpError(createReview(db, "https://github.com/acme/widgets", deps), 400);
    });

    it("404s when the repo is not set up", async (t) => {
      const { db, deps } = harness();
      await expectHttpError(createReview(db, "https://github.com/acme/widgets/pull/7", deps), 404);
    });

    it("409s when the repo clone is not ready", async (t) => {
      const { db, deps } = harness();
      insertRepo(db, { cloneState: "pending" });
      const error = await expectHttpError(createReview(db, "https://github.com/acme/widgets/pull/7", deps), 409);
      assert.match(error.message, /pending/);
    });

    it("stores PR data, detects the Jira key and Figma URL, then prepares into the context phase", async (t) => {
      const { db, deps, agent, events } = harness();
      const repo = insertRepo(db);
      const review = await createReview(db, "https://github.com/acme/widgets/pull/7?diff=split", deps);
      watch(t, events, review.id);

      assert.equal(review.phase, "preparing");
      assert.equal(review.repoId, repo.id);
      assert.equal(review.prNumber, 7);
      assert.equal(review.prUrl, "https://github.com/acme/widgets/pull/7");
      assert.equal(review.jiraKey, "WID-1234");
      assert.equal(review.figmaUrl, "https://www.figma.com/design/abc/Widgets?node-id=1-2");
      assert.equal(review.baseRef, "dev");
      assert.equal(review.sessionStarted, false);

      const prepared = await waitFor(() => {
        const row = reviewRow(db, review.id);
        return row.phase === "context" ? row : undefined;
      }, "context phase");
      assert.ok(prepared.worktreePath?.endsWith(`${repo.id}/pr-7`));
      assert.ok(fs.existsSync(path.join(config.paths.reviews, review.id, "system-prompt.md")));
      assert.deepEqual(agent.started, [review.id]);
      assert.equal(agent.sent.length, 1);
      assert.match(agent.sent[0]!, /^Phase: context\./);
      assert.match(agent.sent[0]!, /WID-1234/);
    });

    it("returns the existing review when the same PR is started again", async (t) => {
      const { db, deps, events } = harness();
      insertRepo(db);
      const first = await createReview(db, "https://github.com/acme/widgets/pull/7", deps);
      watch(t, events, first.id);
      const again = await createReview(db, "https://github.com/acme/widgets/pull/7/files", deps);
      assert.equal(again.id, first.id);
      assert.equal(db.select().from(reviews).all().length, 1);
    });

    it("starts a new review when the only earlier one failed", async (t) => {
      const { db, deps, events } = harness();
      insertRepo(db);
      const first = await createReview(db, "https://github.com/acme/widgets/pull/7", deps);
      watch(t, events, first.id);
      await waitFor(() => (reviewRow(db, first.id).phase === "context" ? true : undefined), "context phase");
      db.update(reviews).set({ phase: "failed" }).where(eq(reviews.id, first.id)).run();
      const again = await createReview(db, "https://github.com/acme/widgets/pull/7", deps);
      watch(t, events, again.id);
      assert.notEqual(again.id, first.id);
    });

    it("prefers the title over the body for the Jira key when the branch has none", async (t) => {
      const pr: PullRequestInfo = { ...samplePr, headRef: "feature/export", title: "WID-3: export", body: "relates to OTHER-9" };
      const { db, deps } = harness(pr);
      insertRepo(db);
      const review = await createReview(db, "https://github.com/acme/widgets/pull/8", deps);
      assert.equal(review.jiraKey, "WID-3");
      assert.equal(review.figmaUrl, null);
    });

    it("marks the review failed when preparation throws", async (t) => {
      const { db, deps, agent } = harness();
      insertRepo(db);
      agent.startError = new Error("claude is not installed");
      const review = await createReview(db, "https://github.com/acme/widgets/pull/9", deps);
      const failed = await waitFor(() => {
        const row = reviewRow(db, review.id);
        return row.phase === "failed" ? row : undefined;
      }, "failed phase");
      assert.equal(failed.phaseError, "claude is not installed");
    });
  });

  describe("prepareReview", () => {
    it("publishes review.updated for the worktree and the phase change", async (t) => {
      const { db, deps, events } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "preparing", worktreePath: null });
      watch(t, events, review.id);
      const prepared = await prepareReview(db, review, deps);
      assert.equal(prepared.phase, "context");
      const updates = events.filter((event) => event.type === "review.updated");
      assert.equal(updates.length, 2);
    });

    it("prepares the workspace with the repo's related paths and stores the warnings", async (t) => {
      const { db, deps, events } = harness();
      const repo = insertRepo(db, { relatedPaths: ["/code/related"] });
      const review = insertReview(db, repo, { phase: "preparing", worktreePath: null });
      watch(t, events, review.id);
      const seen: { worktree: string; relatedPaths: string[] }[] = [];
      deps.prepareWorkspace = async (worktree, relatedPaths) => {
        seen.push({ worktree, relatedPaths });
        return ["Could not pull related repo /code/related"];
      };
      const prepared = await prepareReview(db, review, deps);
      assert.deepEqual(seen, [{ worktree: prepared.worktreePath, relatedPaths: ["/code/related"] }]);
      assert.deepEqual(prepared.setupWarnings, ["Could not pull related repo /code/related"]);
      assert.equal(prepared.phase, "context");
    });
  });

  describe("completeContext", () => {
    it("refuses outside the context phase", async (t) => {
      const { db, deps } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "checkpoint" });
      await expectHttpError(completeContext(db, review.id, undefined, deps), 409);
    });

    it("refuses while a gap is unanswered, then moves to checkpoint with the answers in the message", async (t) => {
      const { db, deps, agent, events } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo);
      watch(t, events, review.id);
      const gap = db.insert(contextGaps).values({ id: newId(), reviewId: review.id, question: "Which tenants?" }).returning().get();

      await expectHttpError(completeContext(db, review.id, undefined, deps), 409);

      answerGap(db, review.id, gap.id, "All of them");
      assert.equal(events.at(-1)?.type, "gap.answered");

      const updated = await completeContext(db, review.id, "Focus on the CSV path", deps);
      assert.equal(updated.phase, "checkpoint");
      assert.equal(updated.reviewerNotes, "Focus on the CSV path");
      assert.deepEqual(agent.started, [review.id]);
      const message = agent.sent.at(-1)!;
      assert.match(message, /^Phase: checkpoint\./);
      assert.match(message, /Which tenants\?/);
      assert.match(message, /All of them/);
      assert.match(message, /Focus on the CSV path/);
      const prompt = fs.readFileSync(path.join(config.paths.reviews, review.id, "system-prompt.md"), "utf8");
      assert.match(prompt, /All of them/);
      assert.equal(events.at(-1)?.type, "review.updated");
    });

    it("404s for a gap on another review", async (t) => {
      const { db } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo);
      await expectHttpError(() => answerGap(db, review.id, newId(), "x"), 404);
    });
  });

  describe("autoConfirmContext", () => {
    const area = { status: "known" as const, summary: "Checked.", evidence: ["src/a.ts:1"] };
    const clean = { consumers: area, data: area, legacy: { ...area, status: "not_applicable" as const }, acceptance: [] };

    it("moves to checkpoint on its own when nothing is unknown and no gap is open", async () => {
      const { db, deps, agent } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { intentSummary: "Export widgets.", contextChecklist: clean });
      const updated = await autoConfirmContext(db, review.id, deps);
      assert.equal(updated?.phase, "checkpoint");
      assert.equal(updated?.contextAutoConfirmed, true);
      assert.match(agent.sent.at(-1)!, /^Phase: checkpoint\./);
    });

    it("waits for the reviewer when something is unknown, a gap is open, or no checklist exists", async () => {
      const { db, deps, agent } = harness();
      const repo = insertRepo(db);
      const unknown = insertReview(db, repo, {
        intentSummary: "Export widgets.",
        contextChecklist: { ...clean, consumers: { ...area, status: "unknown", question: "Does billing read this?" } },
      });
      const openGap = insertReview(db, repo, { intentSummary: "Export widgets.", contextChecklist: clean });
      db.insert(contextGaps).values({ id: newId(), reviewId: openGap.id, question: "Which tenants?" }).run();
      const noChecklist = insertReview(db, repo, { intentSummary: "Export widgets." });
      const unclear = insertReview(db, repo, {
        intentSummary: "Export widgets.",
        contextChecklist: { ...clean, acceptance: [{ criterion: "Cap at 50k rows", status: "unclear" }] },
      });

      for (const review of [unknown, openGap, noChecklist, unclear]) {
        assert.equal(await autoConfirmContext(db, review.id, deps), null);
        assert.equal(reviewRow(db, review.id).phase, "context");
      }
      assert.equal(agent.sent.length, 0);
    });

    it("leaves the flag off when the reviewer confirms by hand", async () => {
      const { db, deps } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { contextAutoConfirmed: true });
      const updated = await completeContext(db, review.id, undefined, deps);
      assert.equal(updated.contextAutoConfirmed, false);
    });
  });

  describe("rerunStep", () => {
    const ready = { worktreePath: "/tmp/wt", intentSummary: "Export widgets as CSV." };

    it("refuses while the review is still preparing", async (t) => {
      const { db, deps } = harness();
      const review = insertReview(db, insertRepo(db), { phase: "preparing" });
      await expectHttpError(rerunStep(db, review.id, "requirements", undefined, deps), 409);
    });

    it("re-runs requirements and marks every later step that has data as stale", async (t) => {
      const { db, deps, agent } = harness();
      const review = insertReview(db, insertRepo(db), { ...ready, phase: "review", approachSummary: "Fits", approachDecision: "proceed" });
      const updated = await rerunStep(db, review.id, "requirements", undefined, deps);
      assert.equal(updated.phase, "context");
      assert.equal(updated.approachDecision, null);
      assert.deepEqual([...updated.staleSteps].sort(), ["approach", "code_review", "intent", "requirements"]);
      assert.match(agent.sent.at(-1)!, /^Phase: context\./);
      assert.match(agent.sent.at(-1)!, /re-run requested by the reviewer/);
    });

    it("re-runs intent from the review phase with new notes and asks for a fresh approach", async (t) => {
      const { db, deps, agent } = harness();
      const review = insertReview(db, insertRepo(db), {
        ...ready,
        phase: "review",
        approachSummary: "Fits",
        approachDecision: "proceed",
        staleSteps: ["intent", "approach", "code_review"],
      });
      const updated = await rerunStep(db, review.id, "intent", "Only issued invoices", deps);
      assert.equal(updated.phase, "checkpoint");
      assert.equal(updated.reviewerNotes, "Only issued invoices");
      assert.deepEqual([...updated.staleSteps].sort(), ["approach", "code_review"]);
      assert.match(agent.sent.at(-1)!, /^Phase: checkpoint\./);
      assert.match(agent.sent.at(-1)!, /Only issued invoices/);
      assert.match(agent.sent.at(-1)!, /call `set_approach_summary` again/);
    });

    it("refuses to re-run the code review before the approach was accepted", async (t) => {
      const { db, deps } = harness();
      const review = insertReview(db, insertRepo(db), { ...ready, phase: "checkpoint", approachSummary: "Fits" });
      await expectHttpError(rerunStep(db, review.id, "code_review", undefined, deps), 409);
    });

    it("re-runs the code review into planning", async (t) => {
      const { db, deps, agent } = harness();
      const review = insertReview(db, insertRepo(db), { ...ready, phase: "done", approachSummary: "Fits", approachDecision: "proceed" });
      const updated = await rerunStep(db, review.id, "code_review", undefined, deps);
      assert.equal(updated.phase, "planning");
      assert.deepEqual(updated.staleSteps, ["code_review"]);
      assert.match(agent.sent.at(-1)!, /^Phase: planning\./);
    });

    it("refuses while the agent is busy", async (t) => {
      const { db, deps, agent } = harness();
      const review = insertReview(db, insertRepo(db), { ...ready, phase: "checkpoint", approachSummary: "Fits" });
      agent.isBusy = () => true;
      await expectHttpError(rerunStep(db, review.id, "approach", undefined, deps), 409);
    });
  });

  describe("syncPullRequest", () => {
    const synced = { worktreePath: "/tmp/wt", intentSummary: "Export widgets as CSV.", title: samplePr.title, body: samplePr.body, headSha: "abc123" };

    it("does nothing when the PR has not changed", async () => {
      const { db, deps, agent } = harness();
      const review = insertReview(db, insertRepo(db), { ...synced, phase: "review" });
      const result = await syncPullRequest(db, review.id, deps);
      assert.equal(result.changed, false);
      assert.equal(result.review.phase, "review");
      assert.equal(agent.sent.length, 0);
    });

    it("moves the worktree to the new head and restarts requirements", async () => {
      const { db, agent } = harness();
      const checkouts: string[] = [];
      const deps = makeDeps(agent, { ...samplePr, headSha: "def456" });
      deps.ensureWorktree = async (_clonePath, _repoId, _prNumber, headSha) => {
        checkouts.push(headSha);
        return "/tmp/wt";
      };
      const review = insertReview(db, insertRepo(db), { ...synced, phase: "done", approachSummary: "Fits", approachDecision: "proceed" });
      const result = await syncPullRequest(db, review.id, deps);
      assert.equal(result.changed, true);
      assert.deepEqual(checkouts, ["def456"]);
      assert.equal(result.review.headSha, "def456");
      assert.equal(result.review.phase, "context");
      assert.deepEqual([...result.review.staleSteps].sort(), ["approach", "code_review", "intent", "requirements"]);
      assert.match(agent.sent.at(-1)!, /head moved from abc123 to def456/);
    });

    it("records which PR files changed since the last code review", async () => {
      const { db, agent } = harness();
      const deps = makeDeps(agent, { ...samplePr, headSha: "def456" });
      deps.changedFiles = async () => [
        { status: "M", path: "src/export.ts" },
        { status: "A", path: "src/csv.ts" },
      ];
      deps.run = async (_cmd, args) => ({ stdout: args[1] === "--name-only" ? "src/export.ts\nREADME.md\n" : "", stderr: "" });
      const review = insertReview(db, insertRepo(db), { ...synced, phase: "review", approachSummary: "Fits", approachDecision: "proceed" });
      const result = await syncPullRequest(db, review.id, deps);
      assert.equal(result.review.reviewedSha, "abc123");
      assert.deepEqual(result.review.updatedPaths, ["src/export.ts"]);
      assert.match(agent.sent.at(-1)!, /Files changed since the last code review:\n\n- `src\/export.ts`/);
    });

    it("keeps comparing against the last reviewed commit until the code review is re-run", async () => {
      const { db, agent } = harness();
      const deps = makeDeps(agent, { ...samplePr, headSha: "fff999" });
      const diffs: string[][] = [];
      deps.run = async (_cmd, args) => {
        diffs.push(args);
        return { stdout: "src/export.ts\n", stderr: "" };
      };
      const review = insertReview(db, insertRepo(db), {
        ...synced,
        headSha: "def456",
        phase: "context",
        approachDecision: "proceed",
        reviewedSha: "abc123",
        staleSteps: ["requirements", "intent", "approach", "code_review"],
      });
      const result = await syncPullRequest(db, review.id, deps);
      assert.equal(result.review.reviewedSha, "abc123");
      assert.deepEqual(diffs[0], ["diff", "--name-only", "abc123", "HEAD"]);
    });

    it("has nothing to compare against before the first code review", async () => {
      const { db, agent } = harness();
      const deps = makeDeps(agent, { ...samplePr, headSha: "def456" });
      const review = insertReview(db, insertRepo(db), { ...synced, phase: "checkpoint" });
      const result = await syncPullRequest(db, review.id, deps);
      assert.equal(result.review.reviewedSha, null);
      assert.equal(result.review.updatedPaths, null);
    });

    it("refuses while the agent is busy", async () => {
      const { db, deps, agent } = harness();
      const review = insertReview(db, insertRepo(db), { ...synced, phase: "review" });
      agent.isBusy = () => true;
      await expectHttpError(syncPullRequest(db, review.id, deps), 409);
    });
  });

  describe("decideApproach", () => {
    it("refuses outside the checkpoint phase", async (t) => {
      const { db, deps } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "context" });
      await expectHttpError(decideApproach(db, review.id, { decision: "proceed" }, deps), 409);
    });

    it("proceed moves to planning and sends the plan prompt", async (t) => {
      const { db, deps, agent } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "checkpoint" });
      const updated = await decideApproach(db, review.id, { decision: "proceed" }, deps);
      assert.equal(updated.phase, "planning");
      assert.equal(updated.approachDecision, "proceed");
      assert.match(agent.sent.at(-1)!, /^Phase: planning\./);
    });

    it("correct keeps the phase and needs a note", async (t) => {
      const { db, deps, agent } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "checkpoint" });
      await expectHttpError(decideApproach(db, review.id, { decision: "correct" }, deps), 400);
      const updated = await decideApproach(db, review.id, { decision: "correct", note: "It is a repository, not a service" }, deps);
      assert.equal(updated.phase, "checkpoint");
      assert.equal(updated.approachDecision, null);
      assert.match(agent.sent.at(-1)!, /corrected your approach summary/);
      assert.match(agent.sent.at(-1)!, /> It is a repository, not a service/);
    });

    it("reject records the decision and opens the review phase with no steps", async (t) => {
      const { db, deps, agent } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "checkpoint" });
      const updated = await decideApproach(db, review.id, { decision: "reject" }, deps);
      assert.equal(updated.phase, "review");
      assert.equal(updated.approachDecision, "reject");
      assert.match(agent.sent.at(-1)!, /rejected the approach/);
      assert.match(agent.sent.at(-1)!, /did not leave a note/);
      assert.equal(db.select().from(steps).where(eq(steps.reviewId, review.id)).all().length, 0);
    });
  });

  describe("sendChat", () => {
    it("stores the message, publishes it and forwards it to the agent", async (t) => {
      const { db, deps, agent, events } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo);
      watch(t, events, review.id);
      const message = await sendChat(db, review.id, "Why this pattern?", deps);
      assert.equal(message.role, "reviewer");
      assert.deepEqual(agent.started, [review.id]);
      assert.deepEqual(agent.sent, ["Why this pattern?"]);
      assert.equal(events.filter((event) => event.type === "chat.message").length, 1);
    });

    it("409s when the agent cannot be started", async (t) => {
      const { db, deps, agent } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo);
      agent.startError = new Error("system prompt missing");
      const error = await expectHttpError(sendChat(db, review.id, "hello", deps), 409);
      assert.match(error.message, /system prompt missing/);
      assert.equal(agent.sent.length, 0);
    });
  });

  describe("setFileState", () => {
    function plan(db: Db, review: Review): { step: typeof steps.$inferSelect; files: Array<typeof stepFiles.$inferSelect> } {
      const step = db
        .insert(steps)
        .values({ id: newId(), reviewId: review.id, position: 0, title: "Export service", purpose: "Build rows", risk: "high" })
        .returning()
        .get();
      const files = db
        .insert(stepFiles)
        .values([
          { id: newId(), reviewId: review.id, stepId: step.id, position: 0, path: "src/export.ts" },
          { id: newId(), reviewId: review.id, stepId: step.id, position: 1, path: "src/export.test.ts" },
          { id: newId(), reviewId: review.id, stepId: step.id, position: 2, path: "pnpm-lock.yaml", skipped: true, skipReason: "lockfile" },
        ])
        .returning()
        .all();
      return { step, files };
    }

    it("never asks the agent to review a file just because it was opened", async (t) => {
      const { db, deps, agent, events } = harness();
      const review = insertReview(db, insertRepo(db), { phase: "review" });
      watch(t, events, review.id);
      const { files } = plan(db, review);
      await setFileState(db, review.id, files[0]!.id, "in_progress", deps);
      assert.equal(agent.sent.length, 0);
    });

    it("tracks step state and asks on done without comments", async (t) => {
      const { db, deps, agent, events } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "review" });
      watch(t, events, review.id);
      const { step, files } = plan(db, review);
      const [exportFile, testFile, lockfile] = files as [typeof files[number], typeof files[number], typeof files[number]];

      await setFileState(db, review.id, exportFile.id, "in_progress", deps);
      assert.equal(agent.sent.length, 0);
      assert.equal(db.select().from(steps).where(eq(steps.id, step.id)).get()?.state, "in_progress");
      assert.ok(events.some((event) => event.type === "file.updated"));
      assert.ok(events.some((event) => event.type === "steps.updated"));

      await setFileState(db, review.id, exportFile.id, "done", deps);
      assert.equal(agent.sent.length, 1);
      assert.match(agent.sent[0]!, /marked `src\/export.ts` as done without leaving any comments/);
      assert.equal(db.select().from(steps).where(eq(steps.id, step.id)).get()?.state, "in_progress");

      await setFileState(db, review.id, lockfile.id, "in_progress", deps);
      assert.equal(agent.sent.length, 1);

      await addReviewerFinding(
        db,
        review.id,
        { path: "src/export.test.ts", line: 4, severity: "nit", title: "Name", body: "Rename this test" },
        deps,
      );
      assert.equal(agent.sent.length, 2);
      assert.match(agent.sent[1]!, /on `src\/export.test.ts` line 4/);

      await setFileState(db, review.id, testFile.id, "done", deps);
      assert.equal(agent.sent.length, 2);
      assert.equal(db.select().from(steps).where(eq(steps.id, step.id)).get()?.state, "done");
    });

    it("sends every file the up-front pass missed in one message, at most twice per plan", async () => {
      const { db, deps, agent } = harness();
      const review = insertReview(db, insertRepo(db), { phase: "review" });
      const { files } = plan(db, review);
      const [exportFile] = files as [typeof files[number]];
      db.update(stepFiles).set({ checked: ["Totals are rounded"] }).where(eq(stepFiles.id, exportFile.id)).run();

      assert.deepEqual(await continueUpfrontReview(db, review.id, deps), ["src/export.test.ts"]);
      assert.equal(agent.sent.length, 1);
      assert.match(agent.sent[0]!, /The up-front review is not finished/);
      assert.match(agent.sent[0]!, /`src\/export\.test\.ts` \(step "Export service"\)/);
      assert.doesNotMatch(agent.sent[0]!, /pnpm-lock/);

      await continueUpfrontReview(db, review.id, deps);
      assert.deepEqual(await continueUpfrontReview(db, review.id, deps), []);
      assert.equal(agent.sent.length, 2);
    });

    it("does nothing while the agent is busy, outside the review phase, or when every file is covered", async () => {
      const { db, deps, agent } = harness();
      const repo = insertRepo(db);
      const busy = insertReview(db, repo, { phase: "review" });
      plan(db, busy);
      agent.isBusy = () => true;
      assert.deepEqual(await continueUpfrontReview(db, busy.id, deps), []);
      agent.isBusy = () => false;

      const planning = insertReview(db, repo, { phase: "planning" });
      plan(db, planning);
      assert.deepEqual(await continueUpfrontReview(db, planning.id, deps), []);

      const covered = insertReview(db, repo, { phase: "review" });
      plan(db, covered);
      db.update(stepFiles).set({ checked: ["ok"] }).where(eq(stepFiles.reviewId, covered.id)).run();
      assert.deepEqual(await continueUpfrontReview(db, covered.id, deps), []);
      assert.equal(agent.sent.length, 0);
    });
  });

  describe("findings", () => {
    function aiFinding(db: Db, review: Review, status: typeof findings.$inferSelect.status = "proposed"): typeof findings.$inferSelect {
      return db
        .insert(findings)
        .values({
          id: newId(),
          reviewId: review.id,
          path: "src/export.ts",
          line: 10,
          origin: "ai",
          severity: "should_fix",
          title: "Unbounded query",
          body: "Add a limit",
          confidence: "high",
          status,
        })
        .returning()
        .get();
    }

    it("reviewer findings are accepted on creation and publish finding.added", async (t) => {
      const { db, deps, events } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "review" });
      watch(t, events, review.id);
      const finding = await addReviewerFinding(db, review.id, { path: "src/a.ts", severity: "nit", title: "T", body: "B" }, deps);
      assert.equal(finding.origin, "reviewer");
      assert.equal(finding.status, "accepted");
      assert.equal(events.at(-1)?.type, "finding.added");
    });

    it("follows the allowed transitions for ai findings", async (t) => {
      const { db, events } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "review" });
      watch(t, events, review.id);
      const finding = aiFinding(db, review);

      await expectHttpError(() => updateFinding(db, review.id, finding.id, { status: "posted" }), 409);
      await expectHttpError(() => updateFinding(db, review.id, finding.id, { status: "rejected" }), 400);

      const parked = updateFinding(db, review.id, finding.id, { status: "parked" });
      assert.equal(parked.status, "parked");
      assert.equal(events.at(-1)?.type, "finding.updated");

      await expectHttpError(() => updateFinding(db, review.id, finding.id, { status: "proposed" }), 409);
      const accepted = updateFinding(db, review.id, finding.id, { status: "accepted", severity: "nit", body: "Edited" });
      assert.equal(accepted.status, "accepted");
      assert.equal(accepted.severity, "nit");
      assert.equal(accepted.body, "Edited");

      await expectHttpError(() => updateFinding(db, review.id, finding.id, { status: "rejected", rejectReason: "x" }), 409);
      assert.equal(updateFinding(db, review.id, finding.id, { status: "parked" }).status, "parked");
      const rejected = updateFinding(db, review.id, finding.id, { status: "rejected", rejectReason: "Already handled upstream" });
      assert.equal(rejected.status, "rejected");
      assert.equal(rejected.rejectReason, "Already handled upstream");
      await expectHttpError(() => updateFinding(db, review.id, finding.id, { status: "accepted" }), 409);
    });

    it("edits title and evidence, clears blank evidence, and locks them once posted", async (t) => {
      const { db } = harness();
      const review = insertReview(db, insertRepo(db), { phase: "review" });
      const finding = aiFinding(db, review);
      const edited = updateFinding(db, review.id, finding.id, { title: "Use `clockNow`", evidence: "  See `a.ts:3`  " });
      assert.equal(edited.title, "Use `clockNow`");
      assert.equal(edited.evidence, "See `a.ts:3`");
      assert.equal(updateFinding(db, review.id, finding.id, { evidence: "  " }).evidence, null);
      db.update(findings).set({ status: "posted" }).where(eq(findings.id, finding.id)).run();
      await expectHttpError(() => updateFinding(db, review.id, finding.id, { evidence: "late" }), 409);
    });

    it("lets reviewer findings be edited or dropped but not re-staged", async (t) => {
      const { db, deps } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "review" });
      const finding = await addReviewerFinding(db, review.id, { path: "src/a.ts", severity: "nit", title: "T", body: "B" }, deps);
      const edited = updateFinding(db, review.id, finding.id, { body: "Better wording", severity: "should_fix" });
      assert.equal(edited.body, "Better wording");
      assert.equal(edited.severity, "should_fix");
      await expectHttpError(() => updateFinding(db, review.id, finding.id, { status: "parked" }), 409);
      assert.equal(updateFinding(db, review.id, finding.id, { status: "rejected" }).status, "rejected");
    });

    it("locks posted findings", async (t) => {
      const { db } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "done" });
      const finding = aiFinding(db, review, "posted");
      await expectHttpError(() => updateFinding(db, review.id, finding.id, { status: "parked" }), 409);
      await expectHttpError(() => updateFinding(db, review.id, finding.id, { body: "x" }), 409);
    });

    it("404s for a finding on another review", async (t) => {
      const { db } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "review" });
      await expectHttpError(() => updateFinding(db, review.id, newId(), { status: "accepted" }), 404);
    });
  });

  describe("file content", () => {
    it("reads the chosen side and 404s when git has no such path", async (t) => {
      const { db, deps } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "review" });
      const step = db
        .insert(steps)
        .values({ id: newId(), reviewId: review.id, position: 0, title: "S", purpose: "P", risk: "low" })
        .returning()
        .get();
      const [present, missing] = db
        .insert(stepFiles)
        .values([
          { id: newId(), reviewId: review.id, stepId: step.id, position: 0, path: "src/export.ts" },
          { id: newId(), reviewId: review.id, stepId: step.id, position: 1, path: "src/missing.ts" },
        ])
        .returning()
        .all() as [typeof stepFiles.$inferSelect, typeof stepFiles.$inferSelect];

      assert.deepEqual(await fileContent(db, review.id, present.id, "new", deps), { path: "src/export.ts", content: "out:show HEAD:src/export.ts" });
      assert.deepEqual(await fileContent(db, review.id, present.id, "old", deps), {
        path: "src/export.ts",
        content: "out:show origin/dev:src/export.ts",
      });
      await expectHttpError(fileContent(db, review.id, missing.id, "old", deps), 404);
    });

    it("diffs against the last reviewed commit when asked", async () => {
      const { db, deps } = harness();
      const repo = insertRepo(db);
      const review = insertReview(db, repo, { phase: "review" });
      const step = db
        .insert(steps)
        .values({ id: newId(), reviewId: review.id, position: 0, title: "S", purpose: "P", risk: "low" })
        .returning()
        .get();
      const file = db
        .insert(stepFiles)
        .values({ id: newId(), reviewId: review.id, stepId: step.id, position: 0, path: "src/export.ts" })
        .returning()
        .get();

      assert.equal((await fileDiff(db, review.id, file.id, deps)).patch, "out:diff origin/dev...HEAD -- src/export.ts");
      await expectHttpError(fileDiff(db, review.id, file.id, deps, true), 409);
      db.update(reviews).set({ reviewedSha: "abc123" }).where(eq(reviews.id, review.id)).run();
      assert.equal((await fileDiff(db, review.id, file.id, deps, true)).patch, "out:diff abc123 HEAD -- src/export.ts");
    });
  });
});
