import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, queryKeys } from "../api/client";
import { ApiError, errorMessage } from "../api/errors";
import type { Finding, PostResult, ReviewDetail, ReviewVerdict } from "../api/types";
import { countBySeverity, severityLabels } from "../lib/review";
import { FindingCard } from "./FindingCard";

type QueuePanelProps = {
  detail: ReviewDetail;
  onClose: () => void;
};

function groupByPath(findings: Finding[]): Array<{ path: string | null; items: Finding[] }> {
  const groups = new Map<string | null, Finding[]>();
  for (const finding of findings) {
    const items = groups.get(finding.path) ?? [];
    items.push(finding);
    groups.set(finding.path, items);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a ?? "").localeCompare(b ?? ""))
    .map(([path, items]) => ({ path, items: items.sort((x, y) => (x.line ?? 0) - (y.line ?? 0)) }));
}

const verdictOptions: Array<{ value: ReviewVerdict; label: string; hint: string }> = [
  { value: "comment", label: "Comment", hint: "Post the comments without a verdict" },
  { value: "approve", label: "Approve", hint: "Approve the pull request on GitHub" },
  { value: "request_changes", label: "Request changes", hint: "Block the pull request until the author responds" },
];

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function postLabel(verdict: ReviewVerdict, comments: number): string {
  const posting = comments > 0 ? `post ${plural(comments, "comment")}` : "";
  if (verdict === "approve") return comments > 0 ? `Approve and ${posting}` : "Approve";
  if (verdict === "request_changes") return comments > 0 ? `Request changes and ${posting}` : "Request changes";
  return comments > 0 ? `Post ${plural(comments, "comment")}` : "Post summary";
}

export function QueuePanel({ detail, onClose }: QueuePanelProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [result, setResult] = useState<PostResult | null>(null);
  const [verdict, setVerdict] = useState<ReviewVerdict>("comment");
  const [summary, setSummary] = useState("");
  const accepted = detail.findings.filter((finding) => finding.status === "accepted");
  const posted = detail.findings.filter((finding) => finding.status === "posted");
  const groups = groupByPath(accepted);
  const counts = countBySeverity(accepted);

  const post = useMutation({
    mutationFn: () => api.postFindings(detail.review.id, { verdict, ...(summary.trim() ? { summary: summary.trim() } : {}) }),
    onSuccess: async (outcome) => {
      setResult(outcome);
      await queryClient.invalidateQueries({ queryKey: queryKeys.review(detail.review.id) });
      const verdictDone = verdict === "comment" || outcome.verdict !== null;
      if (outcome.failed.length === 0 && verdictDone) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
        await queryClient.invalidateQueries({ queryKey: queryKeys.pulls });
        if (detail.review.phase !== "review") return;
        const { review } = detail;
        await navigate("/", {
          state: { posted: { count: outcome.posted, verdict: outcome.verdict, prNumber: review.prNumber, prUrl: review.prUrl, reviewId: review.id } },
        });
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404) {
        setUnavailable(true);
      }
    },
  });

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { phase } = detail.review;
  const verdictOnly = phase === "done" && accepted.length === 0;
  const needsSummary = verdict === "request_changes" && accepted.length === 0 && !summary.trim();
  const blocker = unavailable
    ? "Posting is not available on this server yet"
    : phase !== "review" && !verdictOnly
      ? `Posting is only possible in the review phase (now ${phase})`
      : verdictOnly && verdict === "comment"
        ? "Everything is already posted. Pick Approve or Request changes to add a verdict"
        : verdict === "comment" && accepted.length === 0 && !summary.trim()
          ? "Accept at least one finding or write a summary first"
          : needsSummary
            ? "Write a summary saying what needs to change"
            : null;
  const canPost = blocker === null && !post.isPending;
  const postTitle = blocker ?? (verdict === "comment" ? "Post every accepted finding to the pull request" : "Post the comments, then submit your verdict on GitHub");

  return (
    <div className="queue-backdrop" onClick={onClose}>
      <section className="queue" role="dialog" aria-modal="true" aria-labelledby="queue-title" onClick={(event) => event.stopPropagation()}>
        <header className="queue-head">
          <div>
            <h2 id="queue-title" className="queue-title">
              Queue
            </h2>
            <p className="muted small">
              {accepted.length} accepted comment{accepted.length === 1 ? "" : "s"}
              {counts.length > 0 ? " · " : ""}
              {counts.map((entry) => `${entry.count} ${severityLabels[entry.severity]}`).join(", ")}
              {posted.length > 0 ? ` · ${posted.length} already posted` : ""}
            </p>
          </div>
          <button ref={closeRef} type="button" className="button quiet" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="queue-body">
          {groups.length === 0 ? <p className="muted">Nothing accepted yet. Accept AI findings or add your own comments on the diff.</p> : null}
          {groups.map((group) => (
            <section key={group.path ?? "__pr"} className="queue-group">
              <h3 className="queue-group-title mono">{group.path ?? "Pull request"}</h3>
              {group.items.map((finding) => (
                <FindingCard key={finding.id} finding={finding} prUrl={detail.review.prUrl} />
              ))}
            </section>
          ))}
        </div>

        <div className="queue-verdict">
          <div className="mode-toggle" role="radiogroup" aria-label="Your verdict">
            {verdictOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                className="mode-option"
                aria-checked={verdict === option.value}
                aria-pressed={verdict === option.value}
                title={option.hint}
                onClick={() => setVerdict(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {detail.review.verdict ? (
            <span className="muted small">Last verdict: {verdictOptions.find((option) => option.value === detail.review.verdict)?.label}</span>
          ) : null}
          <textarea
            rows={2}
            value={summary}
            placeholder={verdict === "request_changes" ? "Summary: what needs to change" : "Summary (optional)"}
            aria-label="Review summary"
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>

        {(detail.review.phase === "review" || verdictOnly) && detail.review.phaseError ? (
          <p className="error-text small queue-error">Last attempt: {detail.review.phaseError}</p>
        ) : null}
        <footer className="queue-foot">
          <span title={postTitle} className="post-wrap">
            <button type="button" className="button primary" disabled={!canPost} title={postTitle} onClick={() => post.mutate()}>
              {post.isPending ? "Posting" : postLabel(verdict, accepted.length)}
            </button>
          </span>
          {unavailable ? <span className="muted small">Posting lands with the T8 server work.</span> : null}
          {post.isError && !unavailable ? <span className="error-text small">{errorMessage(post.error)}</span> : null}
          {result ? (
            <span className="small" role="status">
              Posted {result.posted}
              {result.failed.length > 0 ? `, ${result.failed.length} failed and kept in the queue` : ""}
              {result.verdict === "approve" ? ", approved" : result.verdict === "request_changes" ? ", changes requested" : ""}.
            </span>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
