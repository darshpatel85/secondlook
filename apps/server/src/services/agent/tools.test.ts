import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { asc, eq } from "drizzle-orm";
import { config } from "../../config.js";
import { openDb, type Db } from "../../db/client.js";
import { agentQuestions, contextGaps, docEdits, findings, repos, reviews, stepFiles, steps } from "../../db/schema.js";
import { bus, type ReviewEvent } from "../../events/bus.js";
import { newId } from "../../lib/ids.js";
import { toolNames } from "./tool-schemas.js";
import { handleTool, ToolError } from "./tools.js";

type Fixture = { db: Db; repoId: string; reviewId: string; events: ReviewEvent[] };

function setup(t: TestContext): Fixture {
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
      skillPath: "skills/review.md",
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
      phase: "context",
      sessionId: newId(),
      reviewerNotes: "Focus on the CSV path",
    })
    .run();
  const events: ReviewEvent[] = [];
  const unsubscribe = bus.subscribe(reviewId, (event) => events.push(event));
  t.after(unsubscribe);
  return { db, repoId, reviewId, events };
}

const eventTypes = (events: ReviewEvent[]): string[] => events.map((event) => event.type);

const stepPlan = {
  steps: [
    {
      title: "Export service",
      purpose: "Build the CSV rows",
      risk: "high",
      files: [{ path: "src/export.ts" }, { path: "src/export.test.ts" }],
    },
    {
      title: "Wiring",
      purpose: "Expose the route",
      risk: "low",
      files: [{ path: "src/routes.ts" }, { path: "pnpm-lock.yaml", skip: true, skipReason: "lockfile" }],
    },
  ],
};

async function expectToolError(promise: Promise<unknown>, status: number): Promise<ToolError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof ToolError, "expected a ToolError");
    assert.equal(err.status, status);
    return err;
  }
  assert.fail(`expected ToolError ${status}`);
}

test("unknown tool name is a 404", async (t) => {
  const { db, reviewId } = setup(t);
  await expectToolError(handleTool(db, reviewId, "nope", {}), 404);
});

test("unknown review is a 404", async (t) => {
  const { db } = setup(t);
  await expectToolError(handleTool(db, "missing", "set_intent_summary", { summary: "x" }), 404);
});

test("invalid input is a 400 carrying the zod issues", async (t) => {
  const { db, reviewId, events } = setup(t);
  const err = await expectToolError(handleTool(db, reviewId, "propose_finding", { title: "no severity" }), 400);
  const issues = err.payload.issues;
  assert.ok(Array.isArray(issues) && issues.length > 0);
  assert.equal(events.length, 0);
});

test("set_intent_summary writes the review and publishes review.updated", async (t) => {
  const { db, reviewId, events } = setup(t);
  const result = await handleTool(db, reviewId, "set_intent_summary", { summary: "Lets users export widgets as CSV." });
  assert.deepEqual(result, { ok: true });
  const review = db.select().from(reviews).where(eq(reviews.id, reviewId)).get();
  assert.equal(review?.intentSummary, "Lets users export widgets as CSV.");
  assert.deepEqual(eventTypes(events), ["review.updated"]);
});

test("each step's tool clears that step's stale mark only", async (t) => {
  const { db, reviewId } = setup(t);
  db.update(reviews).set({ staleSteps: ["requirements", "approach", "code_review"] }).where(eq(reviews.id, reviewId)).run();
  const stale = () => db.select().from(reviews).where(eq(reviews.id, reviewId)).get()?.staleSteps;

  await handleTool(db, reviewId, "set_intent_summary", { summary: "Again." });
  assert.deepEqual(stale(), ["approach", "code_review"]);
  await handleTool(db, reviewId, "set_approach_summary", { overview: "Fits.", parts: [{ title: "Export", points: ["Adds a CSV writer"], observations: [] }] });
  assert.deepEqual(stale(), ["code_review"]);
  await handleTool(db, reviewId, "set_step_plan", stepPlan);
  assert.deepEqual(stale(), []);
});

test("add_context_gap inserts a gap and publishes gap.added", async (t) => {
  const { db, reviewId, events } = setup(t);
  const result = (await handleTool(db, reviewId, "add_context_gap", { question: "Which locales need quoting?" })) as {
    ok: boolean;
    gapId: string;
  };
  assert.equal(result.ok, true);
  const gap = db.select().from(contextGaps).where(eq(contextGaps.id, result.gapId)).get();
  assert.equal(gap?.question, "Which locales need quoting?");
  assert.equal(gap?.reviewId, reviewId);
  assert.deepEqual(eventTypes(events), ["gap.added"]);
});

test("set_approach_summary writes the overview and parts without changing phase", async (t) => {
  const { db, reviewId, events } = setup(t);
  db.update(reviews).set({ phase: "checkpoint" }).where(eq(reviews.id, reviewId)).run();
  const parts = [
    {
      title: "CSV export",
      points: ["Streams rows through a transform."],
      observations: [{ verdict: "concern", title: "Differs from reports", points: ["Other exports buffer in memory, see src/report.ts"] }],
    },
    { title: "Route", points: ["Adds `GET /export`."] },
  ];
  const result = await handleTool(db, reviewId, "set_approach_summary", { overview: "One concern in the export.", parts });
  assert.deepEqual(result, { ok: true });
  const review = db.select().from(reviews).where(eq(reviews.id, reviewId)).get();
  assert.equal(review?.approachSummary, "One concern in the export.");
  assert.equal(review?.approachObservation, null);
  assert.deepEqual(review?.approachParts, [parts[0], { ...parts[1], observations: [] }]);
  assert.equal(review?.phase, "checkpoint");
  assert.deepEqual(eventTypes(events), ["review.updated"]);
});

test("set_step_plan replaces steps and files, moves phase to review", async (t) => {
  const { db, reviewId, events } = setup(t);
  const first = (await handleTool(db, reviewId, "set_step_plan", {
    steps: [{ title: "Old", purpose: "Old plan", risk: "low", files: [{ path: "old.ts" }] }],
  })) as { ok: boolean; stepIds: string[] };
  assert.equal(first.stepIds.length, 1);

  const result = (await handleTool(db, reviewId, "set_step_plan", stepPlan)) as { ok: boolean; stepIds: string[] };
  assert.equal(result.ok, true);
  assert.equal(result.stepIds.length, 2);

  const stepRows = db.select().from(steps).where(eq(steps.reviewId, reviewId)).orderBy(asc(steps.position)).all();
  assert.deepEqual(
    stepRows.map((step) => [step.position, step.title, step.risk]),
    [
      [0, "Export service", "high"],
      [1, "Wiring", "low"],
    ],
  );
  assert.deepEqual(
    stepRows.map((step) => step.id),
    result.stepIds,
  );

  const fileRows = db.select().from(stepFiles).where(eq(stepFiles.reviewId, reviewId)).orderBy(asc(stepFiles.position)).all();
  assert.equal(fileRows.length, 4);
  assert.ok(fileRows.every((file) => file.path !== "old.ts"));
  const lock = fileRows.find((file) => file.path === "pnpm-lock.yaml");
  assert.equal(lock?.skipped, true);
  assert.equal(lock?.skipReason, "lockfile");
  assert.equal(lock?.position, 1);
  assert.equal(lock?.stepId, result.stepIds[1]);

  const review = db.select().from(reviews).where(eq(reviews.id, reviewId)).get();
  assert.equal(review?.phase, "review");

  const last = events.slice(-2);
  assert.deepEqual(eventTypes(last), ["steps.updated", "review.updated"]);
  const published = last[0]?.steps as Array<{ files: unknown[] }>;
  assert.equal(published.length, 2);
  assert.equal(published[0]?.files.length, 2);
});

test("propose_finding inserts an ai finding in proposed status", async (t) => {
  const { db, reviewId, events } = setup(t);
  const result = (await handleTool(db, reviewId, "propose_finding", {
    path: "src/export.ts",
    line: 12,
    severity: "should_fix",
    title: "Unescaped commas",
    body: "Values containing commas break the CSV.",
    evidence: "Traced buildRow, no quoting applied.",
    confidence: "high",
  })) as { ok: boolean; findingId: string };
  assert.equal(result.ok, true);
  const finding = db.select().from(findings).where(eq(findings.id, result.findingId)).get();
  assert.equal(finding?.origin, "ai");
  assert.equal(finding?.status, "proposed");
  assert.equal(finding?.line, 12);
  assert.equal(finding?.endLine, null);
  assert.deepEqual(eventTypes(events), ["finding.added"]);
});

test("record_file_checked updates the matching step file or reports an unknown path", async (t) => {
  const { db, reviewId, events } = setup(t);
  await handleTool(db, reviewId, "set_step_plan", stepPlan);
  events.length = 0;

  const result = await handleTool(db, reviewId, "record_file_checked", {
    path: "src/export.ts",
    checked: ["quoting", "encoding"],
  });
  assert.deepEqual(result, { ok: true });
  const file = db.select().from(stepFiles).where(eq(stepFiles.path, "src/export.ts")).get();
  assert.deepEqual(file?.checked, ["quoting", "encoding"]);
  assert.deepEqual(eventTypes(events), ["file.updated"]);

  events.length = 0;
  const miss = await handleTool(db, reviewId, "record_file_checked", { path: "nowhere.ts", checked: ["x"] });
  assert.deepEqual(miss, { ok: false, reason: "unknown path" });
  assert.equal(events.length, 0);
});

test("ask_reviewer inserts a question and publishes question.added", async (t) => {
  const { db, reviewId, events } = setup(t);
  const result = (await handleTool(db, reviewId, "ask_reviewer", {
    question: "Is the 10k row cap intentional?",
    path: "src/export.ts",
  })) as { ok: boolean; questionId: string };
  const question = db.select().from(agentQuestions).where(eq(agentQuestions.id, result.questionId)).get();
  assert.equal(question?.question, "Is the 10k row cap intentional?");
  assert.equal(question?.path, "src/export.ts");
  assert.equal(question?.answer, null);
  assert.deepEqual(eventTypes(events), ["question.added"]);
});

test("propose_doc_edit inserts a proposed doc edit for the repo", async (t) => {
  const { db, repoId, reviewId, events } = setup(t);
  const result = (await handleTool(db, reviewId, "propose_doc_edit", {
    path: "docs/exports.md",
    diff: "--- a/docs/exports.md\n+++ b/docs/exports.md\n@@ -1 +1,2 @@\n Exports\n+Always quote CSV values.",
    rationale: "The quoting rule was unwritten.",
  })) as { ok: boolean; docEditId: string };
  const edit = db.select().from(docEdits).where(eq(docEdits.id, result.docEditId)).get();
  assert.equal(edit?.repoId, repoId);
  assert.equal(edit?.reviewId, reviewId);
  assert.equal(edit?.status, "proposed");
  assert.deepEqual(eventTypes(events), ["doc_edit.added"]);
});

test("record_memory_entries appends to the repo memory file", async (t) => {
  const { db, repoId, reviewId, events } = setup(t);
  const previousMemoryDir = config.paths.memory;
  config.paths.memory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-memory-"));
  t.after(() => {
    fs.rmSync(config.paths.memory, { recursive: true, force: true });
    config.paths.memory = previousMemoryDir;
  });
  const result = (await handleTool(db, reviewId, "record_memory_entries", {
    entries: [{ section: "review_preferences", text: "Prefers short comments." }],
  })) as { ok: boolean; added: number };
  assert.deepEqual(result, { ok: true, added: 1 });
  const memory = fs.readFileSync(path.join(config.paths.memory, `${repoId}.md`), "utf8");
  assert.match(memory, /## Review preferences\n+- Prefers short comments\./);
  assert.deepEqual(eventTypes(events), ["review.updated"]);
});

test("set_context_checklist stores the checklist and turns unknowns into gaps once", async (t) => {
  const { db, reviewId, events } = setup(t);
  const checklist = {
    consumers: { status: "unknown", summary: "No caller found for the export endpoint.", evidence: [], question: "Does the mobile app call /exports?" },
    data: { status: "known", summary: "Adds export_jobs table.", evidence: ["db/migrate/1.rb:3"] },
    legacy: { status: "not_applicable", summary: "New feature.", evidence: [] },
    acceptance: [{ criterion: "Admins only", status: "unclear" }],
  };
  const first = await handleTool(db, reviewId, "set_context_checklist", checklist);
  assert.deepEqual(first, { ok: true, unknowns: 2 });
  await handleTool(db, reviewId, "set_context_checklist", checklist);

  const gaps = db.select().from(contextGaps).where(eq(contextGaps.reviewId, reviewId)).all();
  assert.deepEqual(gaps.map((gap) => gap.question).sort(), ['Does the mobile app call /exports?', 'Is this acceptance criterion covered, and where? "Admins only"'].sort());
  const review = db.select().from(reviews).where(eq(reviews.id, reviewId)).get();
  assert.equal(review?.contextChecklist?.data.summary, "Adds export_jobs table.");
  assert.equal(eventTypes(events).filter((type) => type === "gap.added").length, 2);
});

test("set_step_plan routes steps by risk and raises sensitive paths", async (t) => {
  const { db, reviewId } = setup(t);
  await handleTool(db, reviewId, "set_step_plan", {
    steps: [
      { title: "Helpers", purpose: "Formatting", risk: "low", files: [{ path: "src/format.ts" }] },
      { title: "Service", purpose: "Logic", risk: "medium", files: [{ path: "src/widgets.ts" }] },
      { title: "Schema", purpose: "Table", risk: "low", files: [{ path: "db/migrate/2_add.rb" }] },
      { title: "Lock", purpose: "Deps", risk: "low", files: [{ path: "src/auth/token.ts", skip: true, skipReason: "generated" }] },
    ],
  });
  const rows = db.select().from(steps).where(eq(steps.reviewId, reviewId)).orderBy(asc(steps.position)).all();
  assert.deepEqual(
    rows.map((step) => [step.title, step.risk, step.routing]),
    [
      ["Helpers", "low", "auto"],
      ["Service", "medium", "findings"],
      ["Schema", "high", "full"],
      ["Lock", "low", "auto"],
    ],
  );
  assert.match(rows[2]?.riskReason ?? "", /database schema/);
});
