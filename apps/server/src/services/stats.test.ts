import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDb, type Db } from "../db/client.js";
import { agentEvents, findings, repos, reviews, stepFiles, steps, type Repo, type Review } from "../db/schema.js";
import { newId } from "../lib/ids.js";
import { computeStats } from "./stats.js";

const minute = 60_000;
const t0 = 1_700_000_000_000;

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
      title: "Review",
      headRef: "feature/x",
      baseRef: "dev",
      headSha: "abc",
      phase: "done",
      sessionId: newId(),
      createdAt: new Date(t0),
      ...overrides,
    })
    .returning()
    .get();
}

function insertFinding(db: Db, reviewId: string, overrides: Partial<typeof findings.$inferInsert>): void {
  db.insert(findings)
    .values({ id: newId(), reviewId, origin: "ai", severity: "nit", title: "t", body: "b", status: "proposed", ...overrides })
    .run();
}

function insertStepWithFiles(db: Db, reviewId: string, risk: "low" | "high", paths: string[], state: "done" | "not_started" = "done"): void {
  const stepId = newId();
  db.insert(steps).values({ id: stepId, reviewId, position: 0, title: "s", purpose: "p", risk, state }).run();
  paths.forEach((path, position) => db.insert(stepFiles).values({ id: newId(), reviewId, stepId, position, path, state }).run());
}

function insertResultEvent(db: Db, reviewId: string, totalCostUsd: number): void {
  db.insert(agentEvents).values({ reviewId, type: "result", payload: { type: "result", total_cost_usd: totalCostUsd } }).run();
}

describe("computeStats", () => {
  it("returns zeros and nulls with no posted reviews", () => {
    const db = openDb(":memory:");
    const repo = insertRepo(db);
    insertReview(db, repo, { phase: "review", postedAt: null });
    const stats = computeStats(db);
    assert.equal(stats.reviews, 0);
    assert.equal(stats.caughtThatIMissed, 0);
    assert.equal(stats.aiNoiseRate, null);
    assert.equal(stats.rubberStampRate, null);
    assert.equal(stats.minutesPerReview, null);
    assert.equal(stats.costUsd, 0);
    assert.deepEqual(stats.findingsBySeverity, { blocking: 0, should_fix: 0, nit: 0, question: 0 });
    assert.deepEqual(stats.perReview, []);
  });

  it("computes the four measures over posted reviews only", () => {
    const db = openDb(":memory:");
    const repo = insertRepo(db);

    const a = insertReview(db, repo, { title: "A", postedAt: new Date(t0 + 30 * minute) });
    insertFinding(db, a.id, { path: "src/a.ts", status: "posted", severity: "blocking" });
    insertFinding(db, a.id, { path: "src/a.ts", status: "posted", severity: "nit" });
    insertFinding(db, a.id, { path: "src/b.ts", status: "rejected", rejectReason: "intended" });
    insertFinding(db, a.id, { path: "src/c.ts", status: "parked" });
    insertFinding(db, a.id, { path: "src/c.ts", origin: "reviewer", status: "posted", severity: "should_fix" });
    insertStepWithFiles(db, a.id, "high", ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
    insertStepWithFiles(db, a.id, "low", ["src/low.ts"]);
    insertResultEvent(db, a.id, 0.4);
    insertResultEvent(db, a.id, 1.25);

    const b = insertReview(db, repo, { title: "B", prNumber: 8, createdAt: new Date(t0 + 60 * minute), postedAt: new Date(t0 + 70 * minute) });
    insertFinding(db, b.id, { path: "src/x.ts", status: "rejected", rejectReason: "noise" });
    insertStepWithFiles(db, b.id, "high", ["src/x.ts"], "not_started");

    const c = insertReview(db, repo, { title: "C", prNumber: 9, createdAt: new Date(t0), postedAt: new Date(t0 + 50 * minute) });

    insertReview(db, repo, { title: "unposted", prNumber: 10, phase: "review", postedAt: null });

    const stats = computeStats(db);

    assert.equal(stats.reviews, 3);
    assert.equal(stats.caughtThatIMissed, 2);
    assert.equal(stats.aiNoiseRate, 2 / 4);
    assert.equal(stats.rubberStampRate, 2 / 4);
    assert.equal(stats.minutesPerReview, 30);
    assert.deepEqual(stats.findingsBySeverity, { blocking: 1, should_fix: 1, nit: 4, question: 0 });
    assert.equal(stats.costUsd, 1.25);

    assert.deepEqual(
      stats.perReview.map((row) => row.id),
      [b.id, c.id, a.id],
    );
    const rowA = stats.perReview.find((row) => row.id === a.id);
    assert.ok(rowA);
    assert.equal(rowA.repoOwner, "acme");
    assert.equal(rowA.minutes, 30);
    assert.equal(rowA.aiFindings, 4);
    assert.equal(rowA.aiPosted, 2);
    assert.equal(rowA.aiRejected, 1);
    assert.equal(rowA.reviewerFindings, 1);
    assert.equal(rowA.posted, 3);
    assert.equal(rowA.highRiskFilesDone, 4);
    assert.equal(rowA.rubberStamped, 2);
    assert.equal(rowA.costUsd, 1.25);
    assert.equal(stats.perReview.find((row) => row.id === b.id)?.costUsd, null);
  });
});
