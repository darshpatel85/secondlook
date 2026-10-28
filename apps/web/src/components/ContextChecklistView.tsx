import type { ChecklistArea, ContextChecklist } from "../api/types";
import { Markdown } from "./Markdown";

const areaTitles: Array<{ key: "consumers" | "data" | "legacy"; title: string }> = [
  { key: "consumers", title: "What uses this code" },
  { key: "data", title: "Data" },
  { key: "legacy", title: "Legacy behaviour" },
];

const statusLabels = {
  known: "checked",
  unknown: "unknown",
  not_applicable: "not applicable",
  covered: "covered",
  missing: "missing",
  unclear: "unclear",
} as const;

function StatusChip({ status }: { status: keyof typeof statusLabels }) {
  return (
    <span className="check-status" data-status={status}>
      {statusLabels[status]}
    </span>
  );
}

function Area({ title, area }: { title: string; area: ChecklistArea }) {
  return (
    <li className="check-area">
      <div className="check-head">
        <span className="check-title">{title}</span>
        <StatusChip status={area.status} />
      </div>
      <Markdown text={area.summary} />
      {area.evidence.length > 0 ? (
        <ul className="check-evidence muted small">
          {area.evidence.map((item) => (
            <li key={item} className="mono">
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ContextChecklistView({ checklist }: { checklist: ContextChecklist | null }) {
  if (!checklist) {
    return <p className="muted waiting">Waiting for the agent to check what uses this code, the data and the acceptance criteria.</p>;
  }
  return (
    <div className="checklist">
      <ul className="check-areas">
        {areaTitles.map(({ key, title }) => (
          <Area key={key} title={title} area={checklist[key]} />
        ))}
      </ul>
      <h3 className="check-subhead">Acceptance criteria</h3>
      {checklist.acceptance.length === 0 ? (
        <p className="muted small">No acceptance criteria to map.</p>
      ) : (
        <ul className="check-criteria">
          {checklist.acceptance.map((item) => (
            <li key={item.criterion} className="check-criterion">
              <StatusChip status={item.status} />
              <span>
                {item.criterion}
                {item.coveredBy ? <span className="muted small mono"> · {item.coveredBy}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
