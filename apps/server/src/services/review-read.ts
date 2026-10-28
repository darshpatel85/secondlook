import { asc, desc, eq, getTableColumns } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  agentEvents,
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
  type Step,
  type StepFile,
} from "../db/schema.js";
import { HttpError } from "../lib/http-error.js";
import { optionalImport } from "../lib/optional-import.js";
import type { AgentManager } from "./agent/contracts.js";
import { summariseAssistant } from "./agent/stream.js";

export type ReviewListItem = Review & { repoOwner: string; repoName: string };

export type ReviewDetail = {
  review: Review;
  repo: Repo;
  gaps: ContextGap[];
  steps: Array<Step & { files: StepFile[] }>;
  findings: Finding[];
  questions: AgentQuestion[];
  chat: ChatMessage[];
  activity: ActivityItem[];
  agentBusy: boolean;
};

export type ActivityItem = { id: string; at: Date; tool: string; text: string };

export function listActivity(db: Db, reviewId: string): ActivityItem[] {
  const rows = db
    .select({ id: agentEvents.id, payload: agentEvents.payload, createdAt: agentEvents.createdAt })
    .from(agentEvents)
    .where(eq(agentEvents.reviewId, reviewId))
    .orderBy(asc(agentEvents.id))
    .all();
  const items: ActivityItem[] = [];
  for (const row of rows) {
    if (row.payload.type !== "assistant") continue;
    const { tools } = summariseAssistant(row.payload as { type: string } & Record<string, unknown>);
    tools.forEach((tool, index) => items.push({ id: `${row.id}-${index}`, at: row.createdAt, tool: tool.name, text: tool.summary }));
  }
  return items;
}

type ManagerModule = { agentManager?: Pick<AgentManager, "isBusy"> };

let managerModule: Promise<ManagerModule | null> | undefined;

function loadManager(): Promise<ManagerModule | null> {
  managerModule ??= optionalImport<ManagerModule>(new URL("./agent/manager.js", import.meta.url));
  return managerModule;
}

export async function isAgentBusy(reviewId: string): Promise<boolean> {
  const mod = await loadManager();
  return mod?.agentManager?.isBusy(reviewId) ?? false;
}

export function listReviews(db: Db): ReviewListItem[] {
  const rows = db
    .select({ ...getTableColumns(reviews), repoOwner: repos.owner, repoName: repos.name })
    .from(reviews)
    .innerJoin(repos, eq(reviews.repoId, repos.id))
    .orderBy(desc(reviews.createdAt))
    .all();
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.repoId}#${row.prNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getReview(db: Db, id: string): Review {
  const review = db.select().from(reviews).where(eq(reviews.id, id)).get();
  if (!review) throw new HttpError(404, "Review not found");
  return review;
}

export async function getReviewDetail(db: Db, id: string): Promise<ReviewDetail> {
  const review = getReview(db, id);
  const repo = db.select().from(repos).where(eq(repos.id, review.repoId)).get();
  if (!repo) throw new HttpError(500, "Review has no repo");

  const stepRows = db.select().from(steps).where(eq(steps.reviewId, id)).orderBy(asc(steps.position)).all();
  const fileRows = db.select().from(stepFiles).where(eq(stepFiles.reviewId, id)).orderBy(asc(stepFiles.position)).all();
  const filesByStep = new Map<string, StepFile[]>();
  for (const file of fileRows) {
    const list = filesByStep.get(file.stepId) ?? [];
    list.push(file);
    filesByStep.set(file.stepId, list);
  }

  return {
    review,
    repo,
    gaps: db.select().from(contextGaps).where(eq(contextGaps.reviewId, id)).orderBy(asc(contextGaps.createdAt)).all(),
    steps: stepRows.map((step) => ({ ...step, files: filesByStep.get(step.id) ?? [] })),
    findings: db.select().from(findings).where(eq(findings.reviewId, id)).orderBy(asc(findings.createdAt)).all(),
    questions: db
      .select()
      .from(agentQuestions)
      .where(eq(agentQuestions.reviewId, id))
      .orderBy(asc(agentQuestions.createdAt))
      .all(),
    chat: db.select().from(chatMessages).where(eq(chatMessages.reviewId, id)).orderBy(asc(chatMessages.createdAt)).all(),
    activity: listActivity(db, id),
    agentBusy: await isAgentBusy(id),
  };
}
