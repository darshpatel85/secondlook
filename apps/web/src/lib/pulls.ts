import type { OpenPull } from "../api/types";

export const pullStatuses = ["needs_review", "reviewing", "changes_requested", "approved"] as const;
export type PullStatus = (typeof pullStatuses)[number];

export const pullStatusLabels: Record<PullStatus, string> = {
  needs_review: "Needs review",
  reviewing: "Reviewing here",
  changes_requested: "Changes requested",
  approved: "Approved",
};

export function isReviewingHere(pull: OpenPull): boolean {
  return pull.review !== null && pull.review.phase !== "done" && pull.review.phase !== "failed";
}

export function pullStatus(pull: OpenPull): PullStatus {
  if (isReviewingHere(pull)) return "reviewing";
  if (pull.approval === "approved") return "approved";
  if (pull.approval === "changes_requested") return "changes_requested";
  return "needs_review";
}
