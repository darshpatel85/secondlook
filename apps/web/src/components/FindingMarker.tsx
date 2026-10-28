import type { Finding } from "../api/types";
import { severityLabels } from "../lib/review";
import { Markdown } from "./Markdown";

const statusLabels: Record<Finding["status"], string> = {
  proposed: "proposed",
  accepted: "accepted",
  rejected: "rejected",
  parked: "parked",
  posted: "posted",
};

type FindingMarkerProps = {
  finding: Finding;
  expanded: boolean;
  onToggle: () => void;
};

export function FindingMarker({ finding, expanded, onToggle }: FindingMarkerProps) {
  const origin = finding.origin === "ai" ? "AI" : finding.origin === "chat" ? "from chat" : "you";
  return (
    <button
      type="button"
      className="finding-marker"
      data-severity={finding.severity}
      data-status={finding.status}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="severity-dot" aria-hidden="true" />
      <span className="finding-marker-severity">{severityLabels[finding.severity]}</span>
      <span className="finding-marker-title">
        <Markdown text={finding.title} inline />
      </span>
      <span className="finding-marker-meta">
        {origin} · {statusLabels[finding.status]}
      </span>
    </button>
  );
}
