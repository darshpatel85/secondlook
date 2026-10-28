import type { ReviewPhase } from "../api/types";

const labels: Record<ReviewPhase, string> = {
  preparing: "Preparing",
  context: "Context",
  checkpoint: "Checkpoint",
  planning: "Planning",
  review: "Review",
  posting: "Posting",
  done: "Done",
  failed: "Failed",
};

export function PhaseBadge({ phase }: { phase: ReviewPhase }) {
  return (
    <span className="phase-badge" data-phase={phase}>
      {labels[phase]}
    </span>
  );
}
