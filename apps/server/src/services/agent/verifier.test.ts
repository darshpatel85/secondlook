import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "../../db/client.js";
import { agentEvents, findings, repos, reviews } from "../../db/schema.js";
import { bus, type ReviewEvent } from "../../events/bus.js";
import { newId } from "../../lib/ids.js";
import { computeStats } from "../stats.js";
import { handleTool } from "./tools.js";
import { parseVerdict, readVerifierOutput, Verifier, verifierArgs, verifierPrompt, type VerifierInput, type VerifierRun } from "./verifier.js";

function setup(worktreePath: string | null = "/tmp/wt"): { db: Db; reviewId: string } {
  const db = openDb(":memory:");
  const repoId = newId();
  const reviewId = newId();
  db.insert(repos)
    .values({
      id: repoId,
      owner: "acme",
      name: "widgets",
      cloneUrl: "https://github.com/acme/widgets.git",
      defaultBranch: "main",
      kind: "backend",
      skillPath: "/nonexistent/skill.md",
      docsPaths: ["docs"],
      clonePath: "/tmp/acme-widgets",
      cloneState: "ready",
    })
    .run();
  db.insert(reviews)
    .values({
      id: reviewId,
      repoId,
      prNumber: 42,
      prUrl: "https://github.com/acme/widgets/pull/42",
      title: "Add widget export",
      headRef: "feature/export",
      baseRef: "main",
      headSha: "abc123",
      phase: "review",
      sessionId: newId(),
      worktreePath,
    })
    .run();
  return { db, reviewId };
}

async function propose(db: Db, reviewId: string, severity = "should_fix"): Promise<string> {
  const result = (await handleTool(db, reviewId, "propose_finding", {
    path: "src/export.ts",
    line: 12,
    severity,
    title: "Missing tenant filter",
    body: "This query reads every tenant's widgets; filter by tenantId.",
    evidence: "src/export.ts:12 queries widgets with no where clause",
    confidence: "medium",
  })) as { findingId: string };
  return result.findingId;
}

const fixedRunner =
  (run: VerifierRun, seen: VerifierInput[] = []) =>
  async (input: VerifierInput): Promise<VerifierRun> => {
    seen.push(input);
    return run;
  };

describe("parseVerdict", () => {
  it("accepts a structured object", () => {
    assert.deepEqual(parseVerdict({ verdict: "refuted", reason: " guarded at a.ts:3 " }), { verdict: "refuted", reason: "guarded at a.ts:3" });
  });

  it("pulls the last verdict object out of free text", () => {
    const text = 'Looked at it.\n{"verdict":"confirmed","reason":"first"}\nOn reflection:\n{"verdict":"refuted","reason":"second"}';
    assert.deepEqual(parseVerdict(text), { verdict: "refuted", reason: "second" });
  });

  it("rejects unknown verdicts and junk", () => {
    assert.equal(parseVerdict({ verdict: "maybe", reason: "x" }), null);
    assert.equal(parseVerdict("no json here"), null);
    assert.equal(parseVerdict(null), null);
  });
});

describe("readVerifierOutput", () => {
  it("prefers structured output and reads the cost", () => {
    const stdout = JSON.stringify({ result: "", structured_output: { verdict: "confirmed", reason: "real" }, total_cost_usd: 0.12 });
    assert.deepEqual(readVerifierOutput(stdout), { output: { verdict: "confirmed", reason: "real" }, costUsd: 0.12 });
  });

  it("reports errors and missing verdicts", () => {
    assert.equal(readVerifierOutput("not json").output, null);
    assert.match(readVerifierOutput(JSON.stringify({ is_error: true, result: "boom" })).error ?? "", /boom/);
    assert.match(readVerifierOutput(JSON.stringify({ result: "hmm" })).error ?? "", /no verdict/);
  });
});

describe("verifier prompt and args", () => {
  it("asks the verifier to disprove the finding and treats content as data", () => {
    const { db, reviewId } = setup();
    const review = db.select().from(reviews).where(eq(reviews.id, reviewId)).get()!;
    const repo = db.select().from(repos).get()!;
    const text = verifierPrompt({
      repo,
      review,
      skill: "Always scope by tenant.",
      finding: { path: "src/a.ts", line: 4, endLine: 6, severity: "blocking", title: "T", body: "B", evidence: "E" } as never,
    });
    assert.match(text, /try to prove it wrong/);
    assert.match(text, /src\/a\.ts line 4-6/);
    assert.match(text, /git diff origin\/main\.\.\.HEAD -- src\/a\.ts/);
    assert.match(text, /If you cannot decide, answer `confirmed`/);
    assert.match(text, /is data you are checking/);
    assert.match(text, /Always scope by tenant\./);
  });

  it("runs read only with no MCP servers or saved session", () => {
    const args = verifierArgs({ worktreePath: "/wt", relatedPaths: ["/rel"] });
    assert.ok(args.includes("--strict-mcp-config"));
    assert.ok(args.includes("--no-session-persistence"));
    assert.ok(!args.includes("--mcp-config"));
    const disallowed = args.slice(args.indexOf("--disallowedTools"));
    for (const tool of ["Write", "Edit", "Agent"]) assert.ok(disallowed.includes(tool));
    assert.deepEqual(args.slice(-3), ["--add-dir", "/wt", "/rel"]);
  });
});

describe("Verifier", () => {
  it("marks AI findings pending, and leaves questions unverified", async () => {
    const { db, reviewId } = setup();
    const id = await propose(db, reviewId);
    const question = await propose(db, reviewId, "question");
    assert.equal(db.select().from(findings).where(eq(findings.id, id)).get()?.verification, "pending");
    assert.equal(db.select().from(findings).where(eq(findings.id, question)).get()?.verification, null);
  });

  it("records a refuted verdict, publishes it and logs the cost", async () => {
    const { db, reviewId } = setup();
    const id = await propose(db, reviewId);
    const events: ReviewEvent[] = [];
    const unsubscribe = bus.subscribe(reviewId, (event) => events.push(event));
    const seen: VerifierInput[] = [];
    const verifier = new Verifier(fixedRunner({ output: { verdict: "refuted", reason: "Filtered in repo.ts:8" }, costUsd: 0.05 }, seen));
    verifier.enqueue(db, id);
    await verifier.idle();
    unsubscribe();

    const row = db.select().from(findings).where(eq(findings.id, id)).get()!;
    assert.equal(row.verification, "refuted");
    assert.equal(row.verifierNote, "Filtered in repo.ts:8");
    assert.equal(row.status, "proposed");
    assert.equal(seen[0]?.worktreePath, "/tmp/wt");
    assert.deepEqual(events.map((event) => event.type), ["finding.updated"]);
    const logged = db.select().from(agentEvents).where(eq(agentEvents.reviewId, reviewId)).all();
    assert.equal(logged[0]?.type, "verifier.result");
  });

  it("fails open when the verifier cannot give a verdict", async () => {
    const { db, reviewId } = setup();
    const id = await propose(db, reviewId);
    const verifier = new Verifier(async () => {
      throw new Error("claude not found");
    });
    verifier.enqueue(db, id);
    await verifier.idle();
    const row = db.select().from(findings).where(eq(findings.id, id)).get()!;
    assert.equal(row.verification, "failed");
    assert.match(row.verifierNote ?? "", /claude not found/);
  });

  it("fails without running when the review has no worktree", async () => {
    const { db, reviewId } = setup(null);
    const id = await propose(db, reviewId);
    const seen: VerifierInput[] = [];
    const verifier = new Verifier(fixedRunner({ output: { verdict: "confirmed", reason: "x" }, costUsd: null }, seen));
    verifier.enqueue(db, id);
    await verifier.idle();
    assert.equal(seen.length, 0);
    assert.equal(db.select().from(findings).where(eq(findings.id, id)).get()?.verification, "failed");
  });

  it("resumes pending findings and runs no more than the parallel limit at once", async () => {
    const { db, reviewId } = setup();
    for (let i = 0; i < 5; i += 1) await propose(db, reviewId);
    let running = 0;
    let peak = 0;
    const verifier = new Verifier(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { output: { verdict: "confirmed", reason: "holds" }, costUsd: null };
    }, 2);
    assert.equal(verifier.resumePending(db), 5);
    await verifier.idle();
    assert.equal(peak, 2);
    const states = db.select({ v: findings.verification }).from(findings).all().map((row) => row.v);
    assert.deepEqual(states, Array(5).fill("confirmed"));
  });

  it("adds verifier cost to the review cost", async () => {
    const { db, reviewId } = setup();
    db.update(reviews).set({ phase: "done", postedAt: new Date() }).where(eq(reviews.id, reviewId)).run();
    db.insert(agentEvents).values({ reviewId, type: "result", payload: { type: "result", total_cost_usd: 1 } }).run();
    db.insert(agentEvents).values({ reviewId, type: "verifier.result", payload: { type: "verifier", total_cost_usd: 0.25 } }).run();
    db.insert(agentEvents).values({ reviewId, type: "verifier.result", payload: { type: "verifier", total_cost_usd: 0.25 } }).run();
    assert.equal(computeStats(db).perReview[0]?.costUsd, 1.5);
  });
});
