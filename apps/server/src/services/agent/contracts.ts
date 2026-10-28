import type { Integration } from "../../integrations.js";
import type { ContextGap, Repo, Review } from "../../db/schema.js";

export type AgentStreamEvent = { type: string } & Record<string, unknown>;

export interface AgentManager {
  ensureStarted(review: Review, repo: Repo): Promise<void>;
  send(reviewId: string, text: string): void;
  isBusy(reviewId: string): boolean;
  isRunning(reviewId: string): boolean;
  stop(reviewId: string): Promise<void>;
}

export type PromptDoc = { path: string; content: string };

export type PromptContext = {
  repo: Repo;
  review: Review;
  skill: string;
  docs: PromptDoc[];
  memory: string;
  gaps: ContextGap[];
  integrations: Integration[];
};

export type PhasePrompts = {
  context(ctx: PromptContext): string;
  checkpoint(ctx: PromptContext): string;
  approachCorrection(note: string): string;
  approachRejected(note: string | null): string;
  plan(ctx: PromptContext): string;
  reviewMissedFiles(files: Array<{ path: string; stepTitle: string }>): string;
  fileDoneWithoutComments(path: string): string;
  reviewerComment(input: { path: string; line: number | null; body: string }): string;
  answerQuestion(input: { question: string; answer: string }): string;
  learn(): string;
  prUpdated(input: { oldSha: string; newSha: string; updatedPaths: string[] | null }): string;
  rerun(step: "requirements" | "approach" | "code_review"): string;
};

export const reviewEventTypes = [
  "review.updated",
  "gap.added",
  "gap.answered",
  "steps.updated",
  "file.updated",
  "finding.added",
  "finding.updated",
  "question.added",
  "question.answered",
  "chat.message",
  "agent.activity",
  "agent.turn_done",
  "agent.error",
  "agent.exited",
  "doc_edit.added",
] as const;

export type ReviewEventType = (typeof reviewEventTypes)[number];
