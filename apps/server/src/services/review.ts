import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { config } from "../config.js";
import type { Db } from "../db/client.js";
import {
  agentQuestions,
  chatMessages,
  contextGaps,
  findings,
  repos,
  reviews,
  stepFiles,
  steps,
  type AgentQuestion,
  type ChatMessage,
  type ContextGap,
  type Finding,
  type Repo,
  type Review,
  type ReviewStepKey,
  type Step,
  type StepFile,
} from "../db/schema.js";
import { bus } from "../events/bus.js";
import { HttpError } from "../lib/http-error.js";
import { newId } from "../lib/ids.js";
import { CommandError, run } from "../lib/run.js";
import type { AgentManager, PromptContext, ReviewEventType } from "./agent/contracts.js";
import { buildSystemPrompt, loadPromptContext } from "./agent/context.js";
import { agentManager } from "./agent/manager.js";
import { phasePrompts } from "./agent/prompts.js";
import { checklistQuestions } from "./agent/routing.js";
import { changedFiles, ensureWorktree, fetchPullRequest } from "./git.js";
import { getPullRequest, parsePrUrl } from "./github.js";
import { getReview } from "./review-read.js";
import { prepareWorkspace } from "./workspace.js";

export type ReviewDeps = {
  agentManager: AgentManager;
  getPullRequest: typeof getPullRequest;
  fetchPullRequest: typeof fetchPullRequest;
  ensureWorktree: typeof ensureWorktree;
  loadPromptContext: typeof loadPromptContext;
  changedFiles: typeof changedFiles;
  run: typeof run;
  prepareWorkspace: typeof prepareWorkspace;
};

export const defaultReviewDeps: ReviewDeps = {
  agentManager,
  getPullRequest,
  fetchPullRequest,
  ensureWorktree,
  loadPromptContext,
  changedFiles,
  run,
  prepareWorkspace,
};

export type ApproachDecision = { decision: "proceed" | "reject" | "correct"; note?: string | undefined };
export type StepPatch = { reviewMode?: Step["reviewMode"] | undefined; state?: Step["state"] | undefined; routing?: Step["routing"] | undefined };
export type ReviewerFindingInput = {
  path: string;
  line?: number | undefined;
  endLine?: number | undefined;
  severity: Finding["severity"];
  title: string;
  body: string;
};
export type FindingPatch = {
  status?: Finding["status"] | undefined;
  severity?: Finding["severity"] | undefined;
  body?: string | undefined;
  title?: string | undefined;
  evidence?: string | null | undefined;
  rejectReason?: string | undefined;
};
export type FileSide = "new" | "old";

const jiraKeyPattern = /\b[A-Z][A-Z0-9]+-\d+\b/;
const figmaUrlPattern = /https:\/\/(?:www\.)?figma\.com\/[^\s)>\]"']+/;

const upfrontNudges = new Map<string, { planKey: string; count: number }>();

function publish(reviewId: string, type: ReviewEventType, data: Record<string, unknown>): void {
  bus.publish(reviewId, { type, ...data });
}

function patchReview(db: Db, reviewId: string, patch: Partial<typeof reviews.$inferInsert> = {}): Review {
  return db
    .update(reviews)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(reviews.id, reviewId))
    .returning()
    .get() as Review;
}

function publishReview(db: Db, reviewId: string, patch: Partial<typeof reviews.$inferInsert>): Review {
  const review = patchReview(db, reviewId, patch);
  publish(reviewId, "review.updated", { review });
  return review;
}

function getRepoFor(db: Db, review: Review): Repo {
  const repo = db.select().from(repos).where(eq(repos.id, review.repoId)).get();
  if (!repo) throw new HttpError(500, "Review has no repo");
  return repo;
}

function listGaps(db: Db, reviewId: string): ContextGap[] {
  return db.select().from(contextGaps).where(eq(contextGaps.reviewId, reviewId)).orderBy(asc(contextGaps.createdAt)).all();
}

function listStepsWithFiles(db: Db, reviewId: string): Array<Step & { files: StepFile[] }> {
  const stepRows = db.select().from(steps).where(eq(steps.reviewId, reviewId)).orderBy(asc(steps.position)).all();
  const fileRows = db.select().from(stepFiles).where(eq(stepFiles.reviewId, reviewId)).orderBy(asc(stepFiles.position)).all();
  return stepRows.map((step) => ({ ...step, files: fileRows.filter((file) => file.stepId === step.id) }));
}

function publishSteps(db: Db, reviewId: string): void {
  publish(reviewId, "steps.updated", { steps: listStepsWithFiles(db, reviewId) });
}

function getStepFile(db: Db, reviewId: string, fileId: string): StepFile {
  const file = db
    .select()
    .from(stepFiles)
    .where(and(eq(stepFiles.id, fileId), eq(stepFiles.reviewId, reviewId)))
    .get();
  if (!file) throw new HttpError(404, "File not found");
  return file;
}

function getStep(db: Db, reviewId: string, stepId: string): Step {
  const step = db
    .select()
    .from(steps)
    .where(and(eq(steps.id, stepId), eq(steps.reviewId, reviewId)))
    .get();
  if (!step) throw new HttpError(404, "Step not found");
  return step;
}

function getFinding(db: Db, reviewId: string, findingId: string): Finding {
  const finding = db
    .select()
    .from(findings)
    .where(and(eq(findings.id, findingId), eq(findings.reviewId, reviewId)))
    .get();
  if (!finding) throw new HttpError(404, "Finding not found");
  return finding;
}

function requireWorktree(review: Review): string {
  if (!review.worktreePath) throw new HttpError(409, "Review has no worktree yet");
  return review.worktreePath;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function detectJiraKey(...sources: Array<string | null | undefined>): string | null {
  for (const source of sources) {
    const match = source ? jiraKeyPattern.exec(source) : null;
    if (match) return match[0];
  }
  return null;
}

export function detectFigmaUrl(body: string | null | undefined): string | null {
  const match = body ? figmaUrlPattern.exec(body) : null;
  return match ? match[0] : null;
}

function reviewDir(reviewId: string): string {
  return path.join(config.paths.reviews, reviewId);
}

async function writeSystemPrompt(db: Db, review: Review, repo: Repo, deps: ReviewDeps): Promise<PromptContext> {
  const ctx = await deps.loadPromptContext(repo, review, listGaps(db, review.id));
  const dir = reviewDir(review.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "system-prompt.md"), buildSystemPrompt(ctx), "utf8");
  return ctx;
}

async function ensureAgent(db: Db, review: Review, deps: ReviewDeps): Promise<void> {
  if (deps.agentManager.isRunning(review.id)) return;
  try {
    await deps.agentManager.ensureStarted(review, getRepoFor(db, review));
  } catch (error) {
    throw new HttpError(409, `The review agent is not running: ${describe(error)}`);
  }
}

async function sendToAgent(db: Db, review: Review, text: string, deps: ReviewDeps): Promise<void> {
  await ensureAgent(db, review, deps);
  deps.agentManager.send(review.id, text);
}

export async function createReview(db: Db, prUrl: string, deps: ReviewDeps = defaultReviewDeps): Promise<Review> {
  const ref = parsePrUrl(prUrl);
  if (!ref) throw new HttpError(400, "prUrl must be a GitHub pull request URL");

  const repo = db
    .select()
    .from(repos)
    .where(and(eq(repos.owner, ref.owner), eq(repos.name, ref.repo)))
    .get();
  if (!repo) throw new HttpError(404, `Repo ${ref.owner}/${ref.repo} is not set up`);
  if (repo.cloneState !== "ready") throw new HttpError(409, `Repo ${ref.owner}/${ref.repo} clone is ${repo.cloneState}`);

  const existing = db
    .select()
    .from(reviews)
    .where(and(eq(reviews.repoId, repo.id), eq(reviews.prNumber, ref.number), ne(reviews.phase, "failed")))
    .orderBy(desc(reviews.createdAt))
    .get();
  if (existing) return existing;

  const pr = await deps.getPullRequest(ref);
  const review = db
    .insert(reviews)
    .values({
      id: newId(),
      repoId: repo.id,
      prNumber: ref.number,
      prUrl: `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`,
      title: pr.title,
      body: pr.body,
      author: pr.author,
      headRef: pr.headRef,
      baseRef: pr.baseRef,
      headSha: pr.headSha,
      phase: "preparing",
      sessionId: newId(),
      jiraKey: detectJiraKey(pr.headRef, pr.title, pr.body),
      figmaUrl: detectFigmaUrl(pr.body),
    })
    .returning()
    .get();

  void prepareReview(db, review, deps).catch((error: unknown) => {
    publishReview(db, review.id, { phase: "failed", phaseError: describe(error) });
  });
  return review;
}

export async function prepareReview(db: Db, initial: Review, deps: ReviewDeps = defaultReviewDeps): Promise<Review> {
  const repo = getRepoFor(db, initial);
  await deps.fetchPullRequest(repo.clonePath, initial.prNumber, initial.baseRef);
  const worktreePath = await deps.ensureWorktree(repo.clonePath, repo.id, initial.prNumber, initial.headSha);
  const setupWarnings = await deps.prepareWorkspace(worktreePath, repo.relatedPaths);
  const withWorktree = publishReview(db, initial.id, { worktreePath, setupWarnings });

  const ctx = await writeSystemPrompt(db, withWorktree, repo, deps);
  await deps.agentManager.ensureStarted(withWorktree, repo);

  const review = publishReview(db, initial.id, { phase: "context", phaseError: null });
  deps.agentManager.send(review.id, phasePrompts.context(ctx));
  return review;
}

export function answerGap(db: Db, reviewId: string, gapId: string, answer: string): ContextGap {
  getReview(db, reviewId);
  const gap = db
    .update(contextGaps)
    .set({ answer })
    .where(and(eq(contextGaps.id, gapId), eq(contextGaps.reviewId, reviewId)))
    .returning()
    .get();
  if (!gap) throw new HttpError(404, "Context gap not found");
  patchReview(db, reviewId);
  publish(reviewId, "gap.answered", { gap });
  return gap;
}

function reviewerAnswersBlock(ctx: PromptContext): string {
  const gapLines =
    ctx.gaps.length === 0
      ? "No context gaps were recorded."
      : ctx.gaps.map((gap) => `- Q: ${gap.question}\n  A: ${gap.answer?.trim() ?? ""}`).join("\n");
  const notes = ctx.review.reviewerNotes?.trim() ? ctx.review.reviewerNotes.trim() : "(none)";
  return `For reference, the reviewer's answers to your context gaps:\n\n${gapLines}\n\nReviewer notes:\n\n${notes}`;
}

export async function completeContext(
  db: Db,
  reviewId: string,
  notes: string | undefined,
  deps: ReviewDeps = defaultReviewDeps,
): Promise<Review> {
  const current = getReview(db, reviewId);
  if (current.phase !== "context") throw new HttpError(409, `Context can only be completed in the context phase, not ${current.phase}`);
  return confirmIntent(db, patchReview(db, reviewId, { contextAutoConfirmed: false }), notes, deps);
}

export async function autoConfirmContext(db: Db, reviewId: string, deps: ReviewDeps = defaultReviewDeps): Promise<Review | null> {
  const current = getReview(db, reviewId);
  if (current.phase !== "context" || !current.intentSummary || !current.contextChecklist) return null;
  if (checklistQuestions(current.contextChecklist).length > 0) return null;
  if (listGaps(db, reviewId).some((gap) => !gap.answer?.trim())) return null;
  return confirmIntent(db, patchReview(db, reviewId, { contextAutoConfirmed: true }), undefined, deps);
}

function withStale(review: Review, add: ReviewStepKey[], remove: ReviewStepKey[] = []): ReviewStepKey[] {
  const next = new Set([...review.staleSteps, ...add]);
  for (const step of remove) next.delete(step);
  return [...next];
}

function hasCodeReview(db: Db, review: Review): boolean {
  return review.approachDecision !== null || db.select({ id: steps.id }).from(steps).where(eq(steps.reviewId, review.id)).get() !== undefined;
}

function laterStepsWithData(db: Db, review: Review, after: ReviewStepKey): ReviewStepKey[] {
  const order: ReviewStepKey[] = ["requirements", "intent", "approach", "code_review"];
  const hasData: Record<ReviewStepKey, boolean> = {
    requirements: review.intentSummary !== null,
    intent: review.approachSummary !== null,
    approach: review.approachSummary !== null,
    code_review: hasCodeReview(db, review),
  };
  return order.slice(order.indexOf(after) + 1).filter((step) => hasData[step]);
}

async function confirmIntent(db: Db, current: Review, notes: string | undefined, deps: ReviewDeps, rerun = false): Promise<Review> {
  const unanswered = listGaps(db, current.id).filter((gap) => !gap.answer?.trim());
  if (unanswered.length > 0) throw new HttpError(409, `${unanswered.length} context gap(s) still need an answer`);

  const withNotes = patchReview(db, current.id, { reviewerNotes: notes?.trim() ? notes.trim() : current.reviewerNotes });
  const ctx = await writeSystemPrompt(db, withNotes, getRepoFor(db, withNotes), deps);
  await ensureAgent(db, withNotes, deps);

  const review = publishReview(db, current.id, {
    phase: "checkpoint",
    approachDecision: null,
    staleSteps: withStale(withNotes, laterStepsWithData(db, withNotes, "intent"), ["intent"]),
  });
  const rerunNote = rerun ? `\n\n${phasePrompts.rerun("approach")}` : "";
  deps.agentManager.send(current.id, `${phasePrompts.checkpoint(ctx)}\n\n${reviewerAnswersBlock(ctx)}${rerunNote}`);
  return review;
}

async function restartRequirements(db: Db, current: Review, deps: ReviewDeps, extraNote?: string): Promise<Review> {
  const ctx = await writeSystemPrompt(db, current, getRepoFor(db, current), deps);
  await ensureAgent(db, current, deps);
  const review = publishReview(db, current.id, {
    phase: "context",
    phaseError: null,
    approachDecision: null,
    contextAutoConfirmed: false,
    staleSteps: withStale(current, ["requirements", ...laterStepsWithData(db, current, "requirements")]),
  });
  const note = extraNote ? `\n\n${extraNote}` : "";
  deps.agentManager.send(current.id, `${phasePrompts.context(ctx)}\n\n${phasePrompts.rerun("requirements")}${note}`);
  return review;
}

async function changesSinceReview(
  db: Db,
  current: Review,
  worktree: string,
  baseRef: string,
  deps: ReviewDeps,
): Promise<Pick<Review, "reviewedSha" | "updatedPaths">> {
  const codeReviewFresh = hasCodeReview(db, current) && !current.staleSteps.includes("code_review");
  const reviewedSha = codeReviewFresh ? current.headSha : current.reviewedSha;
  if (!reviewedSha) return { reviewedSha: null, updatedPaths: null };
  try {
    const [{ stdout }, prFiles] = await Promise.all([
      deps.run("git", ["diff", "--name-only", reviewedSha, "HEAD"], { cwd: worktree }),
      deps.changedFiles(worktree, baseRef),
    ]);
    const inPr = new Set(prFiles.map((file) => file.path));
    const updatedPaths = stdout.split("\n").filter((line) => line && inPr.has(line));
    return { reviewedSha, updatedPaths };
  } catch {
    return { reviewedSha: null, updatedPaths: null };
  }
}

export type SyncResult = { review: Review; changed: boolean };

export async function syncPullRequest(db: Db, reviewId: string, deps: ReviewDeps = defaultReviewDeps): Promise<SyncResult> {
  const current = getReview(db, reviewId);
  if (current.phase === "preparing" || !current.worktreePath) throw new HttpError(409, "The review is still being prepared");
  if (deps.agentManager.isBusy(reviewId)) throw new HttpError(409, "The agent is still working. Wait for it to finish, then refetch the PR");

  const repo = getRepoFor(db, current);
  const pr = await deps.getPullRequest({ owner: repo.owner, repo: repo.name, number: current.prNumber });
  const codeChanged = pr.headSha !== current.headSha || pr.baseRef !== current.baseRef;
  const changed = codeChanged || pr.title !== current.title || pr.body !== current.body;
  if (!changed) return { review: current, changed: false };

  let since: Pick<Review, "reviewedSha" | "updatedPaths"> = { reviewedSha: current.reviewedSha, updatedPaths: current.updatedPaths };
  let setupWarnings = current.setupWarnings;
  if (codeChanged) {
    await deps.fetchPullRequest(repo.clonePath, current.prNumber, pr.baseRef);
    const worktree = await deps.ensureWorktree(repo.clonePath, repo.id, current.prNumber, pr.headSha);
    setupWarnings = await deps.prepareWorkspace(worktree, repo.relatedPaths);
    upfrontNudges.delete(reviewId);
    since = await changesSinceReview(db, current, worktree, pr.baseRef, deps);
  }
  const updated = patchReview(db, reviewId, {
    ...since,
    setupWarnings,
    title: pr.title,
    body: pr.body,
    author: pr.author,
    headRef: pr.headRef,
    baseRef: pr.baseRef,
    headSha: pr.headSha,
    jiraKey: detectJiraKey(pr.headRef, pr.title, pr.body) ?? current.jiraKey,
    figmaUrl: detectFigmaUrl(pr.body) ?? current.figmaUrl,
  });
  const warningNote = codeChanged && setupWarnings.length > 0 ? `\n\nSetup warnings:\n\n${setupWarnings.map((w) => `- ${w}`).join("\n")}` : "";
  const note =
    phasePrompts.prUpdated({ oldSha: current.headSha, newSha: pr.headSha, updatedPaths: codeChanged ? since.updatedPaths : null }) + warningNote;
  const review = await restartRequirements(db, updated, deps, note);
  return { review, changed: true };
}

export async function rerunStep(
  db: Db,
  reviewId: string,
  step: ReviewStepKey,
  notes: string | undefined,
  deps: ReviewDeps = defaultReviewDeps,
): Promise<Review> {
  const current = getReview(db, reviewId);
  if (current.phase === "preparing" || !current.worktreePath) throw new HttpError(409, "The review is still being prepared");
  if (deps.agentManager.isBusy(reviewId)) throw new HttpError(409, "The agent is still working. Wait for it to finish, then re-run the step");

  switch (step) {
    case "requirements":
      return restartRequirements(db, current, deps);
    case "intent": {
      if (current.intentSummary === null) throw new HttpError(409, "Wait for the requirements step to finish first");
      return confirmIntent(db, { ...current, phaseError: null }, notes, deps, true);
    }
    case "approach": {
      if (current.approachSummary === null && current.phase !== "checkpoint") throw new HttpError(409, "Confirm the intent before re-running the approach");
      const ctx = await deps.loadPromptContext(getRepoFor(db, current), current, listGaps(db, reviewId));
      await ensureAgent(db, current, deps);
      const review = publishReview(db, reviewId, {
        phase: "checkpoint",
        phaseError: null,
        approachDecision: null,
        staleSteps: withStale(current, ["approach", ...laterStepsWithData(db, current, "approach")]),
      });
      deps.agentManager.send(reviewId, `${phasePrompts.checkpoint(ctx)}\n\n${reviewerAnswersBlock(ctx)}\n\n${phasePrompts.rerun("approach")}`);
      return review;
    }
    case "code_review": {
      if (current.approachDecision !== "proceed") throw new HttpError(409, "Proceed with the approach before re-running the code review");
      const ctx = await deps.loadPromptContext(getRepoFor(db, current), current, listGaps(db, reviewId));
      await ensureAgent(db, current, deps);
      const review = publishReview(db, reviewId, { phase: "planning", phaseError: null, staleSteps: withStale(current, ["code_review"]) });
      deps.agentManager.send(reviewId, `${phasePrompts.plan(ctx)}\n\n${phasePrompts.rerun("code_review")}`);
      return review;
    }
  }
}

export async function decideApproach(
  db: Db,
  reviewId: string,
  input: ApproachDecision,
  deps: ReviewDeps = defaultReviewDeps,
): Promise<Review> {
  const current = getReview(db, reviewId);
  if (current.phase !== "checkpoint") throw new HttpError(409, `The approach can only be decided in the checkpoint phase, not ${current.phase}`);
  const note = input.note?.trim() ? input.note.trim() : null;
  await ensureAgent(db, current, deps);

  switch (input.decision) {
    case "proceed": {
      const ctx = await deps.loadPromptContext(getRepoFor(db, current), current, listGaps(db, reviewId));
      const review = publishReview(db, reviewId, { approachDecision: "proceed", phase: "planning" });
      deps.agentManager.send(reviewId, phasePrompts.plan(ctx));
      return review;
    }
    case "correct": {
      if (!note) throw new HttpError(400, "A correction needs a note");
      const review = patchReview(db, reviewId);
      deps.agentManager.send(reviewId, phasePrompts.approachCorrection(note));
      return review;
    }
    case "reject": {
      const review = publishReview(db, reviewId, { approachDecision: "reject", phase: "review" });
      deps.agentManager.send(reviewId, phasePrompts.approachRejected(note));
      return review;
    }
  }
}

export async function sendChat(db: Db, reviewId: string, text: string, deps: ReviewDeps = defaultReviewDeps): Promise<ChatMessage> {
  const review = getReview(db, reviewId);
  await ensureAgent(db, review, deps);
  const message = db.insert(chatMessages).values({ id: newId(), reviewId, role: "reviewer", content: text }).returning().get();
  patchReview(db, reviewId);
  publish(reviewId, "chat.message", { message });
  deps.agentManager.send(reviewId, text);
  return message;
}

export async function answerQuestion(
  db: Db,
  reviewId: string,
  questionId: string,
  answer: string,
  deps: ReviewDeps = defaultReviewDeps,
): Promise<AgentQuestion> {
  const review = getReview(db, reviewId);
  const question = db
    .update(agentQuestions)
    .set({ answer })
    .where(and(eq(agentQuestions.id, questionId), eq(agentQuestions.reviewId, reviewId)))
    .returning()
    .get();
  if (!question) throw new HttpError(404, "Question not found");
  patchReview(db, reviewId);
  publish(reviewId, "question.answered", { question });
  await sendToAgent(db, review, phasePrompts.answerQuestion({ question: question.question, answer }), deps);
  return question;
}

export function setStepOptions(db: Db, reviewId: string, stepId: string, patch: StepPatch): Step {
  getReview(db, reviewId);
  getStep(db, reviewId, stepId);
  const changes: Partial<typeof steps.$inferInsert> = {};
  if (patch.reviewMode !== undefined) changes.reviewMode = patch.reviewMode;
  if (patch.state !== undefined) changes.state = patch.state;
  if (patch.routing !== undefined) changes.routing = patch.routing;
  const step = db.update(steps).set(changes).where(eq(steps.id, stepId)).returning().get() as Step;
  patchReview(db, reviewId);
  publishSteps(db, reviewId);
  return step;
}

const maxUpfrontNudges = 2;

export async function continueUpfrontReview(db: Db, reviewId: string, deps: ReviewDeps = defaultReviewDeps): Promise<string[]> {
  const review = db.select().from(reviews).where(eq(reviews.id, reviewId)).get();
  if (!review || review.phase !== "review" || deps.agentManager.isBusy(reviewId)) return [];
  const stepRows = listStepsWithFiles(db, reviewId);
  const missed = stepRows
    .filter((step) => step.kind === "code")
    .flatMap((step) => step.files.filter((file) => !file.skipped && file.checked === null).map((file) => ({ path: file.path, stepTitle: step.title })));
  const planKey = stepRows.map((step) => step.id).join(",");
  const nudges = upfrontNudges.get(reviewId);
  const count = nudges?.planKey === planKey ? nudges.count : 0;
  if (missed.length === 0 || count >= maxUpfrontNudges) return [];
  upfrontNudges.set(reviewId, { planKey, count: count + 1 });
  await sendToAgent(db, review, phasePrompts.reviewMissedFiles(missed), deps);
  return missed.map((file) => file.path);
}

function fileHasReviewerOrAcceptedFinding(db: Db, reviewId: string, filePath: string): boolean {
  return db
    .select({ origin: findings.origin, status: findings.status })
    .from(findings)
    .where(and(eq(findings.reviewId, reviewId), eq(findings.path, filePath)))
    .all()
    .some((finding) => finding.origin === "reviewer" || finding.status === "accepted" || finding.status === "posted");
}

function syncStepState(db: Db, step: Step, fileState: StepFile["state"]): boolean {
  const siblings = db.select().from(stepFiles).where(eq(stepFiles.stepId, step.id)).all();
  const active = siblings.filter((file) => !file.skipped);
  let next: Step["state"] | null = null;
  if (fileState === "in_progress" && step.state !== "in_progress") next = "in_progress";
  if (fileState === "done" && active.length > 0 && active.every((file) => file.state === "done")) next = "done";
  if (next === null || next === step.state) return false;
  db.update(steps).set({ state: next }).where(eq(steps.id, step.id)).run();
  return true;
}

export async function setFileState(
  db: Db,
  reviewId: string,
  fileId: string,
  state: StepFile["state"],
  deps: ReviewDeps = defaultReviewDeps,
): Promise<StepFile> {
  const review = getReview(db, reviewId);
  const existing = getStepFile(db, reviewId, fileId);
  const step = getStep(db, reviewId, existing.stepId);

  const file = db.update(stepFiles).set({ state }).where(eq(stepFiles.id, fileId)).returning().get() as StepFile;
  patchReview(db, reviewId);
  publish(reviewId, "file.updated", { file });
  if (syncStepState(db, step, state)) publishSteps(db, reviewId);

  if (state === "done" && !file.skipped && !fileHasReviewerOrAcceptedFinding(db, reviewId, file.path)) {
    await sendToAgent(db, review, phasePrompts.fileDoneWithoutComments(file.path), deps);
  }

  return file;
}

export async function addReviewerFinding(
  db: Db,
  reviewId: string,
  input: ReviewerFindingInput,
  deps: ReviewDeps = defaultReviewDeps,
): Promise<Finding> {
  const review = getReview(db, reviewId);
  const finding = db
    .insert(findings)
    .values({
      id: newId(),
      reviewId,
      path: input.path,
      line: input.line ?? null,
      endLine: input.endLine ?? null,
      origin: "reviewer",
      severity: input.severity,
      title: input.title,
      body: input.body,
      status: "accepted",
    })
    .returning()
    .get();
  patchReview(db, reviewId);
  publish(reviewId, "finding.added", { finding });
  await sendToAgent(db, review, phasePrompts.reviewerComment({ path: input.path, line: input.line ?? null, body: input.body }), deps);
  return finding;
}

const aiTransitions: Partial<Record<Finding["status"], readonly Finding["status"][]>> = {
  proposed: ["accepted", "rejected", "parked"],
  parked: ["accepted", "rejected"],
  accepted: ["parked"],
};

function checkStatusTransition(finding: Finding, status: Finding["status"], rejectReason: string | undefined): void {
  if (status === finding.status) return;
  if (finding.status === "posted") throw new HttpError(409, "A posted finding cannot change status");
  if (finding.origin === "ai") {
    const allowed = aiTransitions[finding.status] ?? [];
    if (!allowed.includes(status)) {
      throw new HttpError(409, `A ${finding.origin} finding cannot go from ${finding.status} to ${status}`);
    }
  } else if (status !== "rejected") {
    throw new HttpError(409, `A ${finding.origin} finding can only be dropped (rejected), not set to ${status}`);
  }
  if (status === "rejected" && finding.origin === "ai" && !rejectReason?.trim()) {
    throw new HttpError(400, "Rejecting a finding needs a rejectReason");
  }
}

export function updateFinding(db: Db, reviewId: string, findingId: string, patch: FindingPatch): Finding {
  getReview(db, reviewId);
  const existing = getFinding(db, reviewId, findingId);
  const editsText = patch.body !== undefined || patch.severity !== undefined || patch.title !== undefined || patch.evidence !== undefined;
  if (existing.status === "posted" && editsText) {
    throw new HttpError(409, "A posted finding cannot be edited");
  }
  const changes: Partial<typeof findings.$inferInsert> = { updatedAt: new Date() };
  if (patch.status !== undefined) {
    checkStatusTransition(existing, patch.status, patch.rejectReason);
    changes.status = patch.status;
  }
  if (patch.rejectReason !== undefined) changes.rejectReason = patch.rejectReason;
  if (patch.severity !== undefined) changes.severity = patch.severity;
  if (patch.body !== undefined) changes.body = patch.body;
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.evidence !== undefined) changes.evidence = patch.evidence?.trim() ? patch.evidence.trim() : null;

  const finding = db.update(findings).set(changes).where(eq(findings.id, findingId)).returning().get() as Finding;
  patchReview(db, reviewId);
  publish(reviewId, "finding.updated", { finding });
  return finding;
}

export async function fileDiff(
  db: Db,
  reviewId: string,
  fileId: string,
  deps: ReviewDeps = defaultReviewDeps,
  sinceReview = false,
): Promise<{ path: string; status: string; patch: string }> {
  const review = getReview(db, reviewId);
  const file = getStepFile(db, reviewId, fileId);
  const worktree = requireWorktree(review);
  if (sinceReview && !review.reviewedSha) throw new HttpError(409, "There is no earlier review to compare against");
  const range = sinceReview && review.reviewedSha ? [review.reviewedSha, "HEAD"] : [`origin/${review.baseRef}...HEAD`];
  const [{ stdout }, changes] = await Promise.all([
    deps.run("git", ["diff", ...range, "--", file.path], { cwd: worktree }),
    deps.changedFiles(worktree, review.baseRef),
  ]);
  const status = changes.find((change) => change.path === file.path)?.status ?? "";
  return { path: file.path, status, patch: stdout };
}

export async function fileContent(
  db: Db,
  reviewId: string,
  fileId: string,
  side: FileSide,
  deps: ReviewDeps = defaultReviewDeps,
): Promise<{ path: string; content: string }> {
  const review = getReview(db, reviewId);
  const file = getStepFile(db, reviewId, fileId);
  const worktree = requireWorktree(review);
  const ref = side === "new" ? "HEAD" : `origin/${review.baseRef}`;
  try {
    const { stdout } = await deps.run("git", ["show", `${ref}:${file.path}`], { cwd: worktree });
    return { path: file.path, content: stdout };
  } catch (error) {
    if (error instanceof CommandError) throw new HttpError(404, `${file.path} does not exist on the ${side} side`);
    throw error;
  }
}
