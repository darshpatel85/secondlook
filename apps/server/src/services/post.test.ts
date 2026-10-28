import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { openDb, type Db } from "../db/client.js";
import { chatMessages, findings, repos, reviews, stepFiles, steps, type Finding, type Repo, type Review } from "../db/schema.js";
import { bus, type ReviewEvent } from "../events/bus.js";
import { HttpError } from "../lib/http-error.js";
import { newId } from "../lib/ids.js";
import type { AgentManager } from "./agent/contracts.js";
import { diffRanges, type LineRange } from "./github.js";
import { commentBody, fitToDiff, postReview, recordPath, type PostDeps, type ReviewRecord } from "./post.js";

class FakeAgentManager implements AgentManager {
  readonly sent: string[] = [];
  running = false;
  startError: Error | null = null;

  async ensureStarted(): Promise<void> {
    if (this.startError) throw this.startError;
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

type LineCall = Parameters<PostDeps["createLineComment"]>;
type IssueCall = Parameters<PostDeps["createIssueComment"]>;
type FileCall = Parameters<PostDeps["createFileComment"]>;
type ReviewCall = Parameters<PostDeps["submitReview"]>;

type Harness = {
  db: Db;
  agent: FakeAgentManager;
  deps: PostDeps;
  lineCalls: LineCall[];
  issueCalls: IssueCall[];
  fileCalls: FileCall[];
  ranges: { value: Map<string, LineRange[] | null> | null };
  failPaths: Set<string>;
  reviewCalls: ReviewCall[];
  pr: { headSha: string; reviewError: Error | null };
  events: ReviewEvent[];
};

function harness(): Harness {
  const db = openDb(":memory:");
  const agent = new FakeAgentManager();
  const lineCalls: LineCall[] = [];
  const issueCalls: IssueCall[] = [];
  const fileCalls: FileCall[] = [];
  const ranges: Harness["ranges"] = { value: null };
  const failPaths = new Set<string>();
  const reviewCalls: ReviewCall[] = [];
  const pr: Harness["pr"] = { headSha: "abc123", reviewError: null };
  let nextCommentId = 1000;
  let clock = 1_700_000_000_000;
  const deps: PostDeps = {
    agentManager: agent,
    createLineComment: async (...args) => {
      if (failPaths.has(args[1].path)) throw new Error(`GitHub said no for ${args[1].path}`);
      lineCalls.push(args);
      nextCommentId += 1;
      return nextCommentId;
    },
    createIssueComment: async (...args) => {
      issueCalls.push(args);
      nextCommentId += 1;
      return nextCommentId;
    },
    createFileComment: async (...args) => {
      fileCalls.push(args);
      nextCommentId += 1;
      return nextCommentId;
    },
    listPullFileRanges: async () => ranges.value,
    getPullRequest: async () => ({ title: "T", body: null, author: null, headRef: "feature/export", baseRef: "dev", headSha: pr.headSha }),
    submitReview: async (...args) => {
      if (pr.reviewError) throw pr.reviewError;
      reviewCalls.push(args);
      return 1;
    },
    now: () => {
      clock += 1000;
      return new Date(clock);
    },
  };
  return { db, agent, deps, lineCalls, issueCalls, fileCalls, ranges, failPaths, reviewCalls, pr, events: [] };
}

function insertRepo(db: Db): Repo {
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
      docsPaths: [],
      clonePath: "/tmp/acme__widgets",
      cloneState: "ready",
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
      phase: "review",
      sessionId: newId(),
      approachDecision: "proceed",
      ...overrides,
    })
    .returning()
    .get();
}

function insertFinding(db: Db, reviewId: string, overrides: Partial<typeof findings.$inferInsert> = {}): Finding {
  return db
    .insert(findings)
    .values({
      id: newId(),
      reviewId,
      path: "src/export.ts",
      line: 10,
      origin: "ai",
      severity: "should_fix",
      title: "Title",
      body: "Body",
      status: "accepted",
      ...overrides,
    })
    .returning()
    .get();
}

function watch(t: TestContext, events: ReviewEvent[], reviewId: string): void {
  t.after(bus.subscribe(reviewId, (event) => events.push(event)));
}

async function expectHttpError(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpError, `expected HttpError, got ${String(error)}`);
    assert.equal(error.statusCode, status);
    return;
  }
  assert.fail(`expected HttpError ${status}`);
}

function readRecord(reviewId: string): ReviewRecord {
  return JSON.parse(fs.readFileSync(recordPath(reviewId), "utf8")) as ReviewRecord;
}

describe("postReview", () => {
  let previousReviewsDir: string;

  before(() => {
    previousReviewsDir = config.paths.reviews;
    config.paths.reviews = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-post-"));
  });

  after(() => {
    fs.rmSync(config.paths.reviews, { recursive: true, force: true });
    config.paths.reviews = previousReviewsDir;
  });

  it("409s outside the review phase", async () => {
    const { db, deps } = harness();
    const repo = insertRepo(db);
    for (const phase of ["context", "checkpoint", "planning", "posting", "done"] as const) {
      const review = insertReview(db, repo, { phase });
      await expectHttpError(postReview(db, review.id, {}, deps), 409);
    }
  });

  it("posts accepted findings in path then line order with the right GitHub shape", async (t) => {
    const h = harness();
    const repo = insertRepo(h.db);
    const review = insertReview(h.db, repo);
    watch(t, h.events, review.id);
    const second = insertFinding(h.db, review.id, { path: "src/b.ts", line: 20, endLine: 24, title: "Range", severity: "blocking", evidence: "traced it" });
    const first = insertFinding(h.db, review.id, { path: "src/a.ts", line: 5, title: "Single" });
    const prLevel = insertFinding(h.db, review.id, { path: null, line: null, title: "Design", severity: "question" });
    insertFinding(h.db, review.id, { path: "src/c.ts", status: "proposed" });
    insertFinding(h.db, review.id, { path: "src/c.ts", status: "rejected", rejectReason: "no" });

    const result = await postReview(h.db, review.id, {}, h.deps);

    assert.equal(result.posted, 3);
    assert.deepEqual(result.failed, []);
    assert.equal(h.lineCalls.length, 2);
    assert.deepEqual(h.lineCalls[0]?.[0], { owner: "acme", repo: "widgets", number: 7 });
    assert.deepEqual(h.lineCalls[0]?.[1], { body: commentBody(first), commitId: "abc123", path: "src/a.ts", line: 5 });
    assert.deepEqual(h.lineCalls[1]?.[1], { body: commentBody(second), commitId: "abc123", path: "src/b.ts", line: 24, startLine: 20 });
    assert.equal(h.issueCalls.length, 1);
    assert.equal(h.issueCalls[0]?.[1], commentBody(prLevel));
    assert.equal(commentBody(second), "Body");

    const rows = h.db.select().from(findings).where(eq(findings.reviewId, review.id)).all();
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.equal(byId.get(first.id)?.status, "posted");
    assert.equal(byId.get(second.id)?.status, "posted");
    assert.equal(byId.get(prLevel.id)?.status, "posted");
    assert.equal(typeof byId.get(first.id)?.githubCommentId, "number");
    assert.equal(rows.filter((row) => row.status === "proposed").length, 1);
    assert.equal(rows.filter((row) => row.status === "rejected").length, 1);

    const done = h.db.select().from(reviews).where(eq(reviews.id, review.id)).get();
    assert.equal(done?.phase, "done");
    assert.ok(done?.postedAt instanceof Date);
    assert.equal(done?.phaseError, null);

    const phases = h.events.filter((event) => event.type === "review.updated").map((event) => (event.review as Review).phase);
    assert.deepEqual(phases, ["posting", "done"]);
    assert.equal(h.events.filter((event) => event.type === "finding.updated").length, 3);
  });

  it("keeps failed findings accepted, returns to review, and still writes the record", async (t) => {
    const h = harness();
    const repo = insertRepo(h.db);
    const review = insertReview(h.db, repo);
    watch(t, h.events, review.id);
    const ok = insertFinding(h.db, review.id, { path: "src/a.ts", line: 1 });
    const bad = insertFinding(h.db, review.id, { path: "src/b.ts", line: 2 });
    h.failPaths.add("src/b.ts");

    const result = await postReview(h.db, review.id, {}, h.deps);

    assert.equal(result.posted, 1);
    assert.deepEqual(
      result.failed.map((finding) => finding.id),
      [bad.id],
    );
    const rows = new Map(h.db.select().from(findings).where(eq(findings.reviewId, review.id)).all().map((row) => [row.id, row]));
    assert.equal(rows.get(ok.id)?.status, "posted");
    assert.equal(rows.get(bad.id)?.status, "accepted");
    assert.equal(rows.get(bad.id)?.githubCommentId, null);

    const after = h.db.select().from(reviews).where(eq(reviews.id, review.id)).get();
    assert.equal(after?.phase, "review");
    assert.ok(after?.postedAt instanceof Date);
    assert.match(after?.phaseError ?? "", /src\/b.ts:2: GitHub said no/);
    assert.deepEqual(h.agent.sent, []);
    assert.deepEqual(readRecord(review.id).posting, { posted: 1, failed: [bad.id] });
  });

  it("writes record.json with the full audit trail and then asks the agent to learn", async () => {
    const h = harness();
    const repo = insertRepo(h.db);
    const review = insertReview(h.db, repo, { reviewerNotes: "Careful with refunds" });
    const step = h.db
      .insert(steps)
      .values({ id: newId(), reviewId: review.id, position: 0, title: "Service", purpose: "Logic", risk: "high", state: "done" })
      .returning()
      .get();
    h.db
      .insert(stepFiles)
      .values({ id: newId(), reviewId: review.id, stepId: step.id, position: 0, path: "src/a.ts", state: "done", checked: ["null handling"] })
      .run();
    h.db.insert(chatMessages).values({ id: newId(), reviewId: review.id, role: "reviewer", content: "hello" }).run();
    h.db.insert(chatMessages).values({ id: newId(), reviewId: review.id, role: "agent", content: "hi" }).run();
    const accepted = insertFinding(h.db, review.id, { path: "src/a.ts", line: 3 });
    const rejected = insertFinding(h.db, review.id, { path: "src/a.ts", line: 9, status: "rejected", rejectReason: "intended" });

    await postReview(h.db, review.id, {}, h.deps);

    const record = readRecord(review.id);
    assert.equal(record.review.id, review.id);
    assert.equal(record.review.phase, "done");
    assert.deepEqual(record.repo, { owner: "acme", name: "widgets" });
    assert.equal(record.approachDecision, "proceed");
    assert.equal(record.chatMessageCount, 2);
    assert.equal(record.findings.length, 2);
    assert.equal(record.findings.find((finding) => finding.id === accepted.id)?.status, "posted");
    assert.equal(record.findings.find((finding) => finding.id === rejected.id)?.rejectReason, "intended");
    assert.equal(record.steps.length, 1);
    assert.equal(record.steps[0]?.risk, "high");
    assert.deepEqual(record.steps[0]?.files[0]?.checked, ["null handling"]);
    assert.equal(record.steps[0]?.files[0]?.state, "done");
    assert.deepEqual(record.posting, { posted: 1, failed: [] });

    assert.equal(h.agent.running, true);
    assert.equal(h.agent.sent.length, 1);
    assert.match(h.agent.sent[0] ?? "", /record_memory_entries/);
  });

  it("does not fail the post when the agent cannot be started for the learn step", async (t) => {
    const h = harness();
    const repo = insertRepo(h.db);
    const review = insertReview(h.db, repo);
    watch(t, h.events, review.id);
    insertFinding(h.db, review.id);
    h.agent.startError = new Error("no claude binary");

    const result = await postReview(h.db, review.id, {}, h.deps);

    assert.equal(result.posted, 1);
    assert.equal(h.db.select().from(reviews).where(eq(reviews.id, review.id)).get()?.phase, "done");
    const errors = h.events.filter((event) => event.type === "agent.error");
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]?.message), /no claude binary/);
  });

  it("posts nothing and finishes as done when the queue is empty", async () => {
    const h = harness();
    const repo = insertRepo(h.db);
    const review = insertReview(h.db, repo);
    const result = await postReview(h.db, review.id, {}, h.deps);
    assert.deepEqual(result, { posted: 0, failed: [], verdict: null });
    assert.equal(h.db.select().from(reviews).where(eq(reviews.id, review.id)).get()?.phase, "done");
    assert.equal(h.reviewCalls.length, 0);
  });

  it("approves after posting the comments, tied to the reviewed commit", async () => {
    const h = harness();
    const review = insertReview(h.db, insertRepo(h.db));
    insertFinding(h.db, review.id);
    const result = await postReview(h.db, review.id, { verdict: "approve", summary: "  Looks good  " }, h.deps);
    assert.equal(result.verdict, "approve");
    assert.equal(h.lineCalls.length, 1);
    assert.deepEqual(h.reviewCalls, [[{ owner: "acme", repo: "widgets", number: 7 }, { event: "APPROVE", body: "Looks good", commitId: "abc123" }]]);
    const row = h.db.select().from(reviews).where(eq(reviews.id, review.id)).get();
    assert.equal(row?.phase, "done");
    assert.equal(row?.verdict, "approve");
  });

  it("approves with no comments", async () => {
    const h = harness();
    const review = insertReview(h.db, insertRepo(h.db));
    const result = await postReview(h.db, review.id, { verdict: "approve" }, h.deps);
    assert.equal(result.verdict, "approve");
    assert.equal(h.reviewCalls[0]?.[1].body, "");
  });

  it("refuses a verdict when the pull request has new commits", async () => {
    const h = harness();
    const review = insertReview(h.db, insertRepo(h.db));
    h.pr.headSha = "def456";
    await expectHttpError(postReview(h.db, review.id, { verdict: "approve" }, h.deps), 409);
    assert.equal(h.db.select().from(reviews).where(eq(reviews.id, review.id)).get()?.phase, "review");
  });

  it("requests changes with a default body pointing at the comments", async () => {
    const h = harness();
    const review = insertReview(h.db, insertRepo(h.db));
    insertFinding(h.db, review.id);
    insertFinding(h.db, review.id, { line: 20 });
    await postReview(h.db, review.id, { verdict: "request_changes" }, h.deps);
    assert.equal(h.reviewCalls[0]?.[1].event, "REQUEST_CHANGES");
    assert.match(h.reviewCalls[0]?.[1].body ?? "", /See the 2 comments/);
  });

  it("needs a summary to request changes with no comments", async () => {
    const h = harness();
    const review = insertReview(h.db, insertRepo(h.db));
    await expectHttpError(postReview(h.db, review.id, { verdict: "request_changes" }, h.deps), 400);
  });

  it("does not submit the verdict when a comment fails", async () => {
    const h = harness();
    const review = insertReview(h.db, insertRepo(h.db));
    insertFinding(h.db, review.id, { path: "src/broken.ts" });
    h.failPaths.add("src/broken.ts");
    const result = await postReview(h.db, review.id, { verdict: "approve" }, h.deps);
    assert.equal(result.verdict, null);
    assert.equal(h.reviewCalls.length, 0);
    assert.equal(h.db.select().from(reviews).where(eq(reviews.id, review.id)).get()?.phase, "review");
  });

  it("returns to review with an error when GitHub rejects the verdict", async () => {
    const h = harness();
    const review = insertReview(h.db, insertRepo(h.db));
    h.pr.reviewError = new Error("Can not approve your own pull request");
    const result = await postReview(h.db, review.id, { verdict: "approve" }, h.deps);
    assert.equal(result.verdict, null);
    const row = h.db.select().from(reviews).where(eq(reviews.id, review.id)).get();
    assert.equal(row?.phase, "review");
    assert.match(row?.phaseError ?? "", /verdict was not submitted.*own pull request/);
  });

  it("lets a finished review be approved later without reposting", async () => {
    const h = harness();
    const review = insertReview(h.db, insertRepo(h.db), { phase: "done" });
    const result = await postReview(h.db, review.id, { verdict: "approve" }, h.deps);
    assert.equal(result.verdict, "approve");
    assert.equal(h.agent.sent.length, 0);
    await expectHttpError(postReview(h.db, review.id, { verdict: "comment" }, h.deps), 409);
  });
});

describe("fitting comments to the diff", () => {
  it("reads the new-side line ranges from a patch", () => {
    const patch = "@@ -1,16 +1,53 @@\n x\n@@ -39,11 +76,11 @@ class\n y\n@@ -5,2 +9,0 @@\n";
    assert.deepEqual(diffRanges(patch), [
      [1, 53],
      [76, 86],
    ]);
  });

  it("keeps a range inside one hunk, trims one that leaves it, and gives up outside the diff", () => {
    const ranges: LineRange[] = [
      [1, 53],
      [76, 86],
      [96, 102],
      [136, 243],
    ];
    assert.deepEqual(fitToDiff(140, 150, ranges), { line: 150, startLine: 140 });
    assert.deepEqual(fitToDiff(79, 105, ranges), { line: 86, startLine: 79 });
    assert.deepEqual(fitToDiff(90, 100, ranges), { line: 100, startLine: 96 });
    assert.deepEqual(fitToDiff(107, 137, ranges), { line: 137, startLine: 136 });
    assert.deepEqual(fitToDiff(84, 90, ranges), { line: 86, startLine: 84 });
    assert.deepEqual(fitToDiff(60, 70, ranges), null);
  });

  it("posts trimmed ranges as line comments and the rest on the file or the PR", async () => {
    const h = harness();
    const review = insertReview(h.db, insertRepo(h.db), { phase: "review" });
    h.ranges.value = new Map([
      ["src/export.ts", [[76, 86], [136, 243]] as LineRange[]],
      ["src/huge.ts", null],
    ]);
    insertFinding(h.db, review.id, { line: 107, endLine: 137 });
    insertFinding(h.db, review.id, { line: 60, endLine: 70, body: "Outside" });
    insertFinding(h.db, review.id, { path: "src/huge.ts", line: 5, body: "No patch" });
    insertFinding(h.db, review.id, { path: "src/elsewhere.ts", line: 3, body: "Not in the PR" });

    const result = await postReview(h.db, review.id, {}, h.deps);

    assert.equal(result.posted, 4);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(h.lineCalls.map((call) => [call[1].startLine, call[1].line]), [[136, 137]]);
    assert.deepEqual(h.fileCalls.map((call) => [call[1].path, call[1].body]).sort(), [
      ["src/export.ts", "Lines 60 to 70: Outside"],
      ["src/huge.ts", "Line 5: No patch"],
    ]);
    assert.deepEqual(h.issueCalls.map((call) => call[1]), ["`src/elsewhere.ts` line 3: Not in the PR"]);
  });
});
