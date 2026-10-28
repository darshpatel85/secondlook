import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
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
  type ContextGap,
  type Finding,
  type Repo,
  type Review,
  type ReviewVerdict,
  type Step,
  type StepFile,
} from "../db/schema.js";
import { bus } from "../events/bus.js";
import { HttpError } from "../lib/http-error.js";
import type { AgentManager } from "./agent/contracts.js";
import { agentManager } from "./agent/manager.js";
import { phasePrompts } from "./agent/prompts.js";
import {
  createFileComment,
  createIssueComment,
  createLineComment,
  getPullRequest,
  listPullFileRanges,
  submitReview,
  type LineRange,
  type PrRef,
  type ReviewEvent,
} from "./github.js";
import { snapshotMemoryBefore } from "./memory.js";
import { getReview } from "./review-read.js";

export type PostDeps = {
  agentManager: AgentManager;
  createLineComment: typeof createLineComment;
  createIssueComment: typeof createIssueComment;
  createFileComment: typeof createFileComment;
  listPullFileRanges: (ref: PrRef) => Promise<Map<string, LineRange[] | null> | null>;
  getPullRequest: typeof getPullRequest;
  submitReview: typeof submitReview;
  now: () => Date;
};

export const defaultPostDeps: PostDeps = {
  agentManager,
  createLineComment,
  createIssueComment,
  createFileComment,
  listPullFileRanges,
  getPullRequest,
  submitReview,
  now: () => new Date(),
};

export type PostInput = { verdict?: ReviewVerdict | undefined; summary?: string | undefined };
export type PostResult = { posted: number; failed: Finding[]; verdict: ReviewVerdict | null };

const reviewEvents: Record<ReviewVerdict, ReviewEvent> = {
  comment: "COMMENT",
  approve: "APPROVE",
  request_changes: "REQUEST_CHANGES",
};

export type ReviewRecord = {
  writtenAt: number;
  review: Review;
  repo: { owner: string; name: string };
  findings: Finding[];
  questions: AgentQuestion[];
  gaps: ContextGap[];
  approachDecision: Review["approachDecision"];
  steps: Array<Omit<Step, "reviewId"> & { files: Array<Pick<StepFile, "id" | "path" | "state" | "skipped" | "skipReason" | "checked">> }>;
  chatMessageCount: number;
  posting: { posted: number; failed: string[] };
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function patchReview(db: Db, reviewId: string, patch: Partial<typeof reviews.$inferInsert>, at: Date): Review {
  const review = db
    .update(reviews)
    .set({ ...patch, updatedAt: at })
    .where(eq(reviews.id, reviewId))
    .returning()
    .get() as Review;
  bus.publish(reviewId, { type: "review.updated", review });
  return review;
}

function repoFor(db: Db, review: Review): Repo {
  const repo = db.select().from(repos).where(eq(repos.id, review.repoId)).get();
  if (!repo) throw new HttpError(500, "Review has no repo");
  return repo;
}

export function commentBody(finding: Finding): string {
  return finding.body.trim();
}

function postingOrder(a: Finding, b: Finding): number {
  const byPath = (a.path ?? "").localeCompare(b.path ?? "");
  if (byPath !== 0) return byPath;
  return (a.line ?? 0) - (b.line ?? 0);
}

export function acceptedFindings(db: Db, reviewId: string): Finding[] {
  return db
    .select()
    .from(findings)
    .where(and(eq(findings.reviewId, reviewId), eq(findings.status, "accepted")))
    .all()
    .sort(postingOrder);
}

export function fitToDiff(start: number, end: number, ranges: LineRange[]): { line: number; startLine?: number } | null {
  const overlapping = ranges.filter(([from, to]) => from <= end && to >= start);
  const contains = (line: number) => overlapping.find(([from, to]) => from <= line && line <= to);
  const hunk = contains(start) ?? contains(end) ?? overlapping[0];
  if (!hunk) return null;
  const first = Math.max(start, hunk[0]);
  const last = Math.min(end, hunk[1]);
  return last > first ? { line: last, startLine: first } : { line: last };
}

function lineLabel(start: number, end: number): string {
  return end > start ? `Lines ${start} to ${end}` : `Line ${start}`;
}

async function postOne(
  ref: PrRef,
  review: Review,
  finding: Finding,
  ranges: Map<string, LineRange[] | null> | null,
  deps: PostDeps,
): Promise<number> {
  const body = commentBody(finding);
  if (finding.path && finding.line) {
    const start = finding.line;
    const end = finding.endLine && finding.endLine > start ? finding.endLine : start;
    const target = { body, commitId: review.headSha, path: finding.path };
    const fileRanges = ranges?.get(finding.path);
    if (ranges && fileRanges === undefined) return deps.createIssueComment(ref, `\`${finding.path}\` ${lineLabel(start, end).toLowerCase()}: ${body}`);
    const fitted = ranges ? (fileRanges ? fitToDiff(start, end, fileRanges) : null) : end > start ? { line: end, startLine: start } : { line: end };
    if (!fitted) return deps.createFileComment(ref, { ...target, body: `${lineLabel(start, end)}: ${body}` });
    return deps.createLineComment(ref, { ...target, ...fitted });
  }
  const where = finding.path ? `\`${finding.path}\`\n\n` : "";
  return deps.createIssueComment(ref, `${where}${body}`);
}

export function recordPath(reviewId: string): string {
  return path.join(config.paths.reviews, reviewId, "record.json");
}

export function buildRecord(db: Db, review: Review, repo: Repo, posting: PostResult, at: Date): ReviewRecord {
  const stepRows = db.select().from(steps).where(eq(steps.reviewId, review.id)).orderBy(asc(steps.position)).all();
  const fileRows = db.select().from(stepFiles).where(eq(stepFiles.reviewId, review.id)).orderBy(asc(stepFiles.position)).all();
  const chatCount = db.select({ id: chatMessages.id }).from(chatMessages).where(eq(chatMessages.reviewId, review.id)).all().length;
  return {
    writtenAt: at.getTime(),
    review,
    repo: { owner: repo.owner, name: repo.name },
    findings: db.select().from(findings).where(eq(findings.reviewId, review.id)).orderBy(asc(findings.createdAt)).all(),
    questions: db.select().from(agentQuestions).where(eq(agentQuestions.reviewId, review.id)).orderBy(asc(agentQuestions.createdAt)).all(),
    gaps: db.select().from(contextGaps).where(eq(contextGaps.reviewId, review.id)).orderBy(asc(contextGaps.createdAt)).all(),
    approachDecision: review.approachDecision,
    steps: stepRows.map(({ reviewId: _reviewId, ...step }) => ({
      ...step,
      files: fileRows
        .filter((file) => file.stepId === step.id)
        .map((file) => ({
          id: file.id,
          path: file.path,
          state: file.state,
          skipped: file.skipped,
          skipReason: file.skipReason,
          checked: file.checked,
        })),
    })),
    chatMessageCount: chatCount,
    posting: { posted: posting.posted, failed: posting.failed.map((finding) => finding.id) },
  };
}

async function writeRecord(record: ReviewRecord): Promise<void> {
  const file = recordPath(record.review.id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(record, null, 2), "utf8");
}

async function startLearning(review: Review, repo: Repo, deps: PostDeps): Promise<void> {
  try {
    if (!deps.agentManager.isRunning(review.id)) await deps.agentManager.ensureStarted(review, repo);
    deps.agentManager.send(review.id, phasePrompts.learn());
  } catch (error) {
    bus.publish(review.id, { type: "agent.error", message: `The agent could not be asked to record memory: ${describe(error)}` });
  }
}

function verdictBody(verdict: ReviewVerdict, summary: string, commentCount: number): string {
  if (summary) return summary;
  if (verdict === "request_changes") return `Requesting changes. See the ${commentCount} comment${commentCount === 1 ? "" : "s"} on this pull request.`;
  return "";
}

export async function postReview(db: Db, reviewId: string, input: PostInput = {}, deps: PostDeps = defaultPostDeps): Promise<PostResult> {
  const current = getReview(db, reviewId);
  const verdict = input.verdict ?? "comment";
  const summary = input.summary?.trim() ?? "";
  const queue = acceptedFindings(db, reviewId);
  const verdictOnly = current.phase === "done" && verdict !== "comment" && queue.length === 0;
  if (current.phase !== "review" && !verdictOnly) {
    throw new HttpError(409, `Comments can only be posted in the review phase, not ${current.phase}`);
  }
  if (verdict === "request_changes" && !summary && queue.length === 0 && !verdictOnly) {
    throw new HttpError(400, "Requesting changes needs a summary or at least one comment");
  }
  if (verdict === "request_changes" && verdictOnly && !summary) throw new HttpError(400, "Requesting changes needs a summary");
  const repo = repoFor(db, current);
  const ref: PrRef = { owner: repo.owner, repo: repo.name, number: current.prNumber };

  if (verdict !== "comment") {
    const pr = await deps.getPullRequest(ref);
    if (pr.headSha !== current.headSha) {
      throw new HttpError(409, "The pull request has new commits since this review. Refetch the PR and review the changes first");
    }
  }

  const posting = patchReview(db, reviewId, { phase: "posting", phaseError: null }, deps.now());
  if (!verdictOnly) await snapshotMemoryBefore(repo.id, reviewId);
  const ranges = queue.some((finding) => finding.path && finding.line) ? await deps.listPullFileRanges(ref).catch(() => null) : null;
  const failed: Finding[] = [];
  const errors: string[] = [];
  let posted = 0;

  for (const finding of queue) {
    try {
      const githubCommentId = await postOne(ref, posting, finding, ranges, deps);
      const updated = db
        .update(findings)
        .set({ status: "posted", githubCommentId, updatedAt: deps.now() })
        .where(eq(findings.id, finding.id))
        .returning()
        .get() as Finding;
      bus.publish(reviewId, { type: "finding.updated", finding: updated });
      posted += 1;
    } catch (error) {
      failed.push(finding);
      errors.push(`${finding.path ?? "pull request"}${finding.line ? `:${finding.line}` : ""}: ${describe(error)}`);
    }
  }

  let submitted: ReviewVerdict | null = null;
  const body = verdictBody(verdict, summary, posted);
  if (failed.length === 0 && (verdict !== "comment" || body)) {
    try {
      await deps.submitReview(ref, { event: reviewEvents[verdict], body, commitId: current.headSha });
      submitted = verdict;
    } catch (error) {
      errors.push(`review verdict: ${describe(error)}`);
    }
  }

  const ok = errors.length === 0;
  const finishedAt = deps.now();
  const failure = failed.length > 0 ? `${failed.length} comment(s) failed to post. ` : "The review verdict was not submitted. ";
  const review = patchReview(
    db,
    reviewId,
    {
      ...(verdictOnly ? {} : { postedAt: finishedAt }),
      ...(submitted ? { verdict: submitted } : {}),
      phase: ok || verdictOnly ? "done" : "review",
      phaseError: ok ? null : `${failure}${errors.join(" | ")}`,
    },
    finishedAt,
  );

  const result: PostResult = { posted, failed, verdict: submitted };
  if (verdictOnly) return result;
  await writeRecord(buildRecord(db, review, repo, result, finishedAt));
  if (review.phase === "done") await startLearning(review, repo, deps);
  return result;
}
