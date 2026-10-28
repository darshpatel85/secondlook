import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  agentQuestions,
  contextGaps,
  docEdits,
  findings,
  reviews,
  stepFiles,
  steps,
  type ContextChecklist,
  type Finding,
  type Review,
  type ReviewStepKey,
  type Step,
  type StepFile,
} from "../../db/schema.js";
import { bus } from "../../events/bus.js";
import { newId } from "../../lib/ids.js";
import { appendMemoryEntries } from "../memory.js";
import { checklistQuestions, routeStep } from "./routing.js";
import type { ReviewEventType } from "./contracts.js";
import { toolInputSchemas, toolNames, type ToolInput, type ToolName } from "./tool-schemas.js";

export class ToolError extends Error {
  constructor(
    readonly status: number,
    readonly payload: { error: string } & Record<string, unknown>,
  ) {
    super(payload.error);
    this.name = "ToolError";
  }
}

const maxStateChars = 8000;

type ToolContext = { db: Db; review: Review };
type ToolHandler<K extends ToolName> = (ctx: ToolContext, input: ToolInput<K>) => Promise<unknown>;

const isToolName = (name: string): name is ToolName => (toolNames as string[]).includes(name);

function publish(reviewId: string, type: ReviewEventType, data: Record<string, unknown>): void {
  bus.publish(reviewId, { type, ...data });
}

export function needsVerification(severity: Finding["severity"]): boolean {
  return severity !== "question";
}

function withoutStale(review: Review, step: ReviewStepKey): ReviewStepKey[] {
  return review.staleSteps.filter((item) => item !== step);
}

function updateReview(db: Db, reviewId: string, patch: Partial<typeof reviews.$inferInsert>): Review {
  return db
    .update(reviews)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(reviews.id, reviewId))
    .returning()
    .get() as Review;
}

function loadStepsWithFiles(db: Db, reviewId: string): Array<Step & { files: StepFile[] }> {
  const stepRows = db.select().from(steps).where(eq(steps.reviewId, reviewId)).orderBy(asc(steps.position)).all();
  const fileRows = db.select().from(stepFiles).where(eq(stepFiles.reviewId, reviewId)).orderBy(asc(stepFiles.position)).all();
  return stepRows.map((step) => ({ ...step, files: fileRows.filter((file) => file.stepId === step.id) }));
}

const handlers: { [K in ToolName]: ToolHandler<K> } = {
  async set_intent_summary({ db, review }, input) {
    const updated = updateReview(db, review.id, { intentSummary: input.summary, staleSteps: withoutStale(review, "requirements") });
    publish(review.id, "review.updated", { review: updated });
    return { ok: true };
  },

  async add_context_gap({ db, review }, input) {
    const gap = db.insert(contextGaps).values({ id: newId(), reviewId: review.id, question: input.question }).returning().get();
    publish(review.id, "gap.added", { gap });
    return { ok: true, gapId: gap.id };
  },

  async set_context_checklist({ db, review }, input) {
    const checklist = input as ContextChecklist;
    const asked = new Set(db.select({ question: contextGaps.question }).from(contextGaps).where(eq(contextGaps.reviewId, review.id)).all().map((gap) => gap.question));
    const questions = checklistQuestions(checklist);
    for (const question of questions) {
      if (asked.has(question)) continue;
      asked.add(question);
      const gap = db.insert(contextGaps).values({ id: newId(), reviewId: review.id, question }).returning().get();
      publish(review.id, "gap.added", { gap });
    }
    const updated = updateReview(db, review.id, { contextChecklist: checklist });
    publish(review.id, "review.updated", { review: updated });
    return { ok: true, unknowns: questions.length };
  },

  async set_approach_summary({ db, review }, input) {
    const updated = updateReview(db, review.id, {
      approachSummary: input.overview,
      approachObservation: null,
      approachParts: input.parts,
      staleSteps: withoutStale(review, "approach"),
    });
    publish(review.id, "review.updated", { review: updated });
    return { ok: true };
  },

  async set_step_plan({ db, review }, input) {
    const { stepIds, updated } = db.transaction((tx) => {
      tx.delete(stepFiles).where(eq(stepFiles.reviewId, review.id)).run();
      tx.delete(steps).where(eq(steps.reviewId, review.id)).run();
      const ids: string[] = [];
      input.steps.forEach((step, stepPosition) => {
        const stepId = newId();
        ids.push(stepId);
        const routed = routeStep(
          step.risk,
          step.files.filter((file) => !file.skip).map((file) => file.path),
        );
        tx.insert(steps)
          .values({ id: stepId, reviewId: review.id, position: stepPosition, title: step.title, purpose: step.purpose, ...routed })
          .run();
        tx.insert(stepFiles)
          .values(
            step.files.map((file, filePosition) => ({
              id: newId(),
              reviewId: review.id,
              stepId,
              position: filePosition,
              path: file.path,
              skipped: file.skip ?? false,
              skipReason: file.skipReason ?? null,
            })),
          )
          .run();
      });
      const row = tx
        .update(reviews)
        .set({ phase: "review", staleSteps: withoutStale(review, "code_review"), updatedAt: new Date() })
        .where(eq(reviews.id, review.id))
        .returning()
        .get() as Review;
      return { stepIds: ids, updated: row };
    });
    publish(review.id, "steps.updated", { steps: loadStepsWithFiles(db, review.id) });
    publish(review.id, "review.updated", { review: updated });
    return { ok: true, stepIds };
  },

  async propose_finding({ db, review }, input) {
    const finding = db
      .insert(findings)
      .values({
        id: newId(),
        reviewId: review.id,
        path: input.path ?? null,
        line: input.line ?? null,
        endLine: input.endLine ?? null,
        origin: "ai",
        severity: input.severity,
        title: input.title,
        body: input.body,
        evidence: input.evidence ?? null,
        confidence: input.confidence,
        status: "proposed",
        verification: needsVerification(input.severity) ? "pending" : null,
      })
      .returning()
      .get();
    publish(review.id, "finding.added", { finding });
    return { ok: true, findingId: finding.id };
  },

  async record_file_checked({ db, review }, input) {
    const files = db
      .update(stepFiles)
      .set({ checked: input.checked })
      .where(and(eq(stepFiles.reviewId, review.id), eq(stepFiles.path, input.path)))
      .returning()
      .all();
    if (files.length === 0) return { ok: false, reason: "unknown path" };
    for (const file of files) publish(review.id, "file.updated", { file });
    return { ok: true };
  },

  async ask_reviewer({ db, review }, input) {
    const question = db
      .insert(agentQuestions)
      .values({ id: newId(), reviewId: review.id, question: input.question, path: input.path ?? null })
      .returning()
      .get();
    publish(review.id, "question.added", { question });
    return { ok: true, questionId: question.id };
  },

  async propose_doc_edit({ db, review }, input) {
    const docEdit = db
      .insert(docEdits)
      .values({
        id: newId(),
        repoId: review.repoId,
        reviewId: review.id,
        path: input.path,
        diff: input.diff,
        rationale: input.rationale,
        status: "proposed",
      })
      .returning()
      .get();
    publish(review.id, "doc_edit.added", { docEdit });
    return { ok: true, docEditId: docEdit.id };
  },

  async record_memory_entries({ db, review }, input) {
    const { added } = await appendMemoryEntries(review.repoId, input.entries);
    const updated = updateReview(db, review.id, {});
    publish(review.id, "review.updated", { review: updated });
    return { ok: true, added };
  },

  async get_review_state({ db, review }) {
    const gaps = db
      .select({ id: contextGaps.id, question: contextGaps.question, answer: contextGaps.answer })
      .from(contextGaps)
      .where(eq(contextGaps.reviewId, review.id))
      .orderBy(asc(contextGaps.createdAt))
      .all();
    const stepRows = loadStepsWithFiles(db, review.id).map((step) => ({
      id: step.id,
      title: step.title,
      risk: step.risk,
      state: step.state,
      reviewMode: step.reviewMode,
      files: step.files.map((file) => ({ path: file.path, state: file.state, skipped: file.skipped })),
    }));
    const findingRows = db
      .select({
        id: findings.id,
        path: findings.path,
        line: findings.line,
        severity: findings.severity,
        status: findings.status,
        title: findings.title,
      })
      .from(findings)
      .where(eq(findings.reviewId, review.id))
      .orderBy(asc(findings.createdAt))
      .all();
    const openQuestions = db
      .select({ id: agentQuestions.id, question: agentQuestions.question, path: agentQuestions.path })
      .from(agentQuestions)
      .where(and(eq(agentQuestions.reviewId, review.id), isNull(agentQuestions.answer)))
      .orderBy(asc(agentQuestions.createdAt))
      .all();

    const state = {
      phase: review.phase,
      intentSummary: review.intentSummary,
      reviewerNotes: review.reviewerNotes,
      gaps,
      steps: stepRows,
      findings: findingRows,
      openQuestions,
    };
    if (JSON.stringify(state).length <= maxStateChars) return state;
    return {
      ...state,
      steps: stepRows.map(({ files, ...step }) => ({ ...step, fileCount: files.length })),
    };
  },
};

function execute<K extends ToolName>(db: Db, reviewId: string, name: K, rawInput: unknown): Promise<unknown> {
  const parsed = toolInputSchemas[name].safeParse(rawInput ?? {});
  if (!parsed.success) throw new ToolError(400, { error: "invalid input", issues: parsed.error.issues });
  const review = db.select().from(reviews).where(eq(reviews.id, reviewId)).get();
  if (!review) throw new ToolError(404, { error: `unknown review: ${reviewId}` });
  const handler: ToolHandler<K> = handlers[name];
  return handler({ db, review }, parsed.data);
}

export async function handleTool(db: Db, reviewId: string, name: string, rawInput: unknown): Promise<unknown> {
  if (!isToolName(name)) throw new ToolError(404, { error: `unknown tool: ${name}` });
  return execute(db, reviewId, name, rawInput);
}
