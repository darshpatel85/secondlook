import { eq, getTableColumns, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { agentEvents, findings, repos, reviews, severities, stepFiles, steps, type Finding } from "../db/schema.js";

export type ReviewStatsRow = {
  id: string;
  title: string;
  prUrl: string;
  prNumber: number;
  repoOwner: string;
  repoName: string;
  createdAt: number;
  postedAt: number;
  minutes: number;
  aiFindings: number;
  aiPosted: number;
  aiRejected: number;
  reviewerFindings: number;
  posted: number;
  highRiskFilesDone: number;
  rubberStamped: number;
  costUsd: number | null;
};

export type Stats = {
  reviews: number;
  caughtThatIMissed: number;
  aiNoiseRate: number | null;
  rubberStampRate: number | null;
  minutesPerReview: number | null;
  findingsBySeverity: Record<Finding["severity"], number>;
  costUsd: number;
  perReview: ReviewStatsRow[];
};

const terminalStatuses: ReadonlySet<Finding["status"]> = new Set(["posted", "rejected"]);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const low = sorted[middle - 1];
  const high = sorted[middle];
  if (high === undefined) return null;
  return sorted.length % 2 === 0 && low !== undefined ? (low + high) / 2 : high;
}

function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

function reviewCost(db: Db, reviewId: string): number | null {
  const rows = db.select({ payload: agentEvents.payload }).from(agentEvents).where(eq(agentEvents.reviewId, reviewId)).all();
  let cost: number | null = null;
  let verifierCost = 0;
  for (const { payload } of rows) {
    const value = payload.total_cost_usd;
    if (typeof value !== "number") continue;
    if (payload.type === "verifier") verifierCost += value;
    else if (payload.type === "result" && (cost === null || value > cost)) cost = value;
  }
  if (verifierCost === 0) return cost;
  return (cost ?? 0) + verifierCost;
}

function fileHasReviewerAttention(fileFindings: Finding[]): boolean {
  return fileFindings.some(
    (finding) =>
      (finding.origin !== "ai" && finding.status !== "rejected") ||
      (finding.origin === "ai" && (finding.status === "accepted" || finding.status === "posted")),
  );
}

function emptySeverityCounts(): Record<Finding["severity"], number> {
  return Object.fromEntries(severities.map((severity) => [severity, 0])) as Record<Finding["severity"], number>;
}

export function computeStats(db: Db): Stats {
  const postedReviews = db
    .select({ ...getTableColumns(reviews), repoOwner: repos.owner, repoName: repos.name })
    .from(reviews)
    .innerJoin(repos, eq(reviews.repoId, repos.id))
    .where(isNotNull(reviews.postedAt))
    .all();

  const findingsBySeverity = emptySeverityCounts();
  const perReview: ReviewStatsRow[] = [];
  let caughtThatIMissed = 0;
  let aiTerminal = 0;
  let aiRejectedTotal = 0;
  let highRiskFilesDone = 0;
  let rubberStampedTotal = 0;
  let costUsd = 0;

  for (const review of postedReviews) {
    const postedAt = review.postedAt;
    if (!postedAt) continue;
    const reviewFindings = db.select().from(findings).where(eq(findings.reviewId, review.id)).all();
    const aiFindings = reviewFindings.filter((finding) => finding.origin === "ai");
    const aiPosted = aiFindings.filter((finding) => finding.status === "posted").length;
    const aiRejected = aiFindings.filter((finding) => finding.status === "rejected").length;
    const reviewerFindings = reviewFindings.filter((finding) => finding.origin !== "ai").length;
    const posted = reviewFindings.filter((finding) => finding.status === "posted").length;
    for (const finding of reviewFindings) findingsBySeverity[finding.severity] += 1;

    const highRiskStepIds = new Set(
      db
        .select({ id: steps.id, risk: steps.risk })
        .from(steps)
        .where(eq(steps.reviewId, review.id))
        .all()
        .filter((step) => step.risk === "high")
        .map((step) => step.id),
    );
    const doneHighRiskFiles = db
      .select()
      .from(stepFiles)
      .where(eq(stepFiles.reviewId, review.id))
      .all()
      .filter((file) => highRiskStepIds.has(file.stepId) && file.state === "done" && !file.skipped);
    const rubberStamped = doneHighRiskFiles.filter(
      (file) => !fileHasReviewerAttention(reviewFindings.filter((finding) => finding.path === file.path)),
    ).length;

    const cost = reviewCost(db, review.id);
    const minutes = (postedAt.getTime() - review.createdAt.getTime()) / 60_000;

    caughtThatIMissed += aiPosted;
    aiTerminal += aiFindings.filter((finding) => terminalStatuses.has(finding.status)).length;
    aiRejectedTotal += aiRejected;
    highRiskFilesDone += doneHighRiskFiles.length;
    rubberStampedTotal += rubberStamped;
    costUsd += cost ?? 0;

    perReview.push({
      id: review.id,
      title: review.title,
      prUrl: review.prUrl,
      prNumber: review.prNumber,
      repoOwner: review.repoOwner,
      repoName: review.repoName,
      createdAt: review.createdAt.getTime(),
      postedAt: postedAt.getTime(),
      minutes,
      aiFindings: aiFindings.length,
      aiPosted,
      aiRejected,
      reviewerFindings,
      posted,
      highRiskFilesDone: doneHighRiskFiles.length,
      rubberStamped,
      costUsd: cost,
    });
  }

  perReview.sort((a, b) => b.postedAt - a.postedAt);

  return {
    reviews: perReview.length,
    caughtThatIMissed,
    aiNoiseRate: ratio(aiRejectedTotal, aiTerminal),
    rubberStampRate: ratio(rubberStampedTotal, highRiskFilesDone),
    minutesPerReview: median(perReview.map((row) => row.minutes)),
    findingsBySeverity,
    costUsd,
    perReview,
  };
}
