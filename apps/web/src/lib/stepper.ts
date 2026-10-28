import { reviewStepKeys, type Review, type ReviewDetail, type ReviewStepKey } from "../api/types";

export const stepLabels: Record<ReviewStepKey, string> = {
  requirements: "Requirements",
  intent: "Intent",
  approach: "Approach",
  code_review: "Code review",
};

export type StepStatus = "done" | "current" | "stale" | "locked";

function hasData(detail: ReviewDetail, step: ReviewStepKey): boolean {
  const { review } = detail;
  switch (step) {
    case "requirements":
      return review.intentSummary !== null;
    case "intent":
    case "approach":
      return review.approachSummary !== null;
    case "code_review":
      return detail.steps.length > 0 || review.approachDecision !== null;
  }
}

export function currentStep(detail: ReviewDetail): ReviewStepKey {
  const { review } = detail;
  switch (review.phase) {
    case "preparing":
      return "requirements";
    case "context":
      return review.intentSummary !== null && !review.staleSteps.includes("requirements") ? "intent" : "requirements";
    case "checkpoint":
      return "approach";
    case "planning":
    case "review":
    case "posting":
    case "done":
      return "code_review";
    case "failed":
      return [...reviewStepKeys].reverse().find((step) => hasData(detail, step)) ?? "requirements";
  }
}

export function stepStatus(detail: ReviewDetail, step: ReviewStepKey): StepStatus {
  const current = reviewStepKeys.indexOf(currentStep(detail));
  const index = reviewStepKeys.indexOf(step);
  if (index === current) return "current";
  if (index < current) return "done";
  return detail.review.staleSteps.includes(step) && hasData(detail, step) ? "stale" : "locked";
}

export function laterStepsWithData(detail: ReviewDetail, step: ReviewStepKey): ReviewStepKey[] {
  return reviewStepKeys.slice(reviewStepKeys.indexOf(step) + 1).filter((key) => hasData(detail, key));
}

export function isRerunning(review: Review, step: ReviewStepKey): boolean {
  return review.staleSteps.includes(step) && (step !== "code_review" || review.phase === "planning");
}
