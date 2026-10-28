import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import { severities, type Finding, type FindingPatch, type Severity } from "../api/types";
import { confidenceLabels, severityLabels } from "../lib/review";
import { Markdown } from "./Markdown";

type Mode = "view" | "edit" | "reject";

const verificationLabels = {
  confirmed: "Verifier confirmed",
  refuted: "Verifier dismissed",
  failed: "Not verified",
} as const;

type FindingCardProps = {
  finding: Finding;
  prUrl?: string;
  showPath?: boolean;
};

function lineLabel(finding: Finding): string | null {
  if (finding.line === null) {
    return null;
  }
  return finding.endLine && finding.endLine !== finding.line ? `lines ${finding.line} to ${finding.endLine}` : `line ${finding.line}`;
}

export function FindingCard({ finding, prUrl, showPath = false }: FindingCardProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("view");
  const [body, setBody] = useState(finding.body);
  const [severity, setSeverity] = useState<Severity>(finding.severity);
  const [reason, setReason] = useState("");

  const patch = useMutation({
    mutationFn: (input: FindingPatch) => api.patchFinding(finding.reviewId, finding.id, input),
    onSuccess: () => {
      setMode("view");
      setReason("");
      return queryClient.invalidateQueries({ queryKey: queryKeys.review(finding.reviewId) });
    },
  });

  const busy = patch.isPending;
  const fromAgent = finding.origin === "ai";
  const terminal = finding.status === "posted" || finding.status === "rejected";
  const where = lineLabel(finding);

  const startEdit = () => {
    setBody(finding.body);
    setSeverity(finding.severity);
    setMode(mode === "edit" ? "view" : "edit");
  };

  const actions = (() => {
    if (finding.status === "posted" || finding.status === "rejected") {
      return null;
    }
    if (fromAgent) {
      return (
        <>
          {finding.status !== "accepted" ? (
            <button type="button" className="button primary" disabled={busy} onClick={() => patch.mutate({ status: "accepted" })}>
              Accept
            </button>
          ) : null}
          <button type="button" className="button" aria-pressed={mode === "edit"} disabled={busy} onClick={startEdit}>
            Edit
          </button>
          {finding.status !== "accepted" ? (
            <button
              type="button"
              className="button"
              aria-pressed={mode === "reject"}
              disabled={busy}
              onClick={() => setMode(mode === "reject" ? "view" : "reject")}
            >
              Reject
            </button>
          ) : null}
          {finding.status !== "parked" ? (
            <button type="button" className="button quiet" disabled={busy} onClick={() => patch.mutate({ status: "parked" })}>
              Park
            </button>
          ) : null}
        </>
      );
    }
    return (
      <>
        <button type="button" className="button" aria-pressed={mode === "edit"} disabled={busy} onClick={startEdit}>
          Edit
        </button>
        <button type="button" className="button quiet" disabled={busy} onClick={() => patch.mutate({ status: "rejected" })}>
          Drop
        </button>
      </>
    );
  })();

  return (
    <article className="finding-card" data-severity={finding.severity} data-status={finding.status} aria-label={finding.title}>
      <header className="finding-head">
        <span className="severity-badge" data-severity={finding.severity}>
          {severityLabels[finding.severity]}
        </span>
        <span className="finding-head-spacer" />
        <span className="finding-status" data-status={finding.status}>
          {finding.status === "rejected" && !fromAgent ? "dropped" : finding.status}
        </span>
      </header>
      <div className="finding-meta muted small">
        <span>{fromAgent ? "proposed by the agent" : finding.origin === "chat" ? "from chat" : "your comment"}</span>
        {fromAgent && finding.confidence ? <span>{confidenceLabels[finding.confidence]}</span> : null}
        {showPath && finding.path ? (
          <span className="mono">
            {finding.path}
            {finding.line ? `:${finding.line}` : ""}
          </span>
        ) : where ? (
          <span>{where}</span>
        ) : (
          <span>whole pull request</span>
        )}
      </div>

      {mode === "edit" ? (
        <div className="finding-edit">
          <div className="field">
            <label htmlFor={`sev-${finding.id}`}>Severity</label>
            <select id={`sev-${finding.id}`} value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}>
              {severities.map((option) => (
                <option key={option} value={option}>
                  {severityLabels[option]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`body-${finding.id}`}>Comment</label>
            <textarea id={`body-${finding.id}`} rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
          </div>
          <p className="muted small">This is exactly what gets posted to GitHub. Markdown works.</p>
          <div className="row-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy || body.trim() === ""}
              onClick={() => patch.mutate({ body: body.trim(), severity })}
            >
              Save
            </button>
            <button type="button" className="button quiet" onClick={() => setMode("view")}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="finding-body">
          <Markdown text={finding.body} />
        </div>
      )}

      {finding.evidence ? (
        <details className="finding-evidence">
          <summary className="muted small">Why the agent thinks this (not posted)</summary>
          <Markdown text={finding.evidence} />
        </details>
      ) : null}
      {fromAgent && finding.verification && finding.verification !== "pending" && finding.verifierNote ? (
        <div className="finding-evidence" data-verification={finding.verification}>
          <span className="callout-label">{verificationLabels[finding.verification]}</span>
          <Markdown text={finding.verifierNote} />
        </div>
      ) : null}
      {finding.agentChallenge ? (
        <div className="finding-evidence">
          <span className="callout-label">Agent challenge</span>
          <Markdown text={finding.agentChallenge} />
        </div>
      ) : null}
      {finding.status === "rejected" && finding.rejectReason ? (
        <p className="finding-reason small">
          <span className="muted">Reason:</span> {finding.rejectReason}
        </p>
      ) : null}
      {finding.status === "posted" && prUrl && finding.githubCommentId ? (
        <a className="small" href={`${prUrl}#discussion_r${finding.githubCommentId}`} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
      ) : null}

      {mode === "reject" ? (
        <div className="finding-edit">
          <label htmlFor={`reason-${finding.id}`}>Why is this rejected?</label>
          <textarea
            id={`reason-${finding.id}`}
            rows={2}
            value={reason}
            placeholder="Shown to the agent so it can learn from the call"
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="row-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy || reason.trim() === ""}
              onClick={() => patch.mutate({ status: "rejected", rejectReason: reason.trim() })}
            >
              Confirm reject
            </button>
            <button type="button" className="button quiet" onClick={() => setMode("view")}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {!terminal && mode !== "reject" && mode !== "edit" ? <div className="row-actions finding-actions">{actions}</div> : null}
      {patch.isError ? <p className="error-text small">{errorMessage(patch.error)}</p> : null}
    </article>
  );
}
