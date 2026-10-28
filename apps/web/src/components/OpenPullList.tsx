import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import type { OpenPull } from "../api/types";
import { formatRelative } from "../lib/time";
import { PhaseBadge } from "./PhaseBadge";

export function useStartReview() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createReview,
    onSuccess: async (review) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.reviews }),
        queryClient.invalidateQueries({ queryKey: queryKeys.pulls }),
      ]);
      await navigate(`/reviews/${encodeURIComponent(review.id)}`);
    },
  });
}

export function PullActions({ pull, onStart, starting }: { pull: OpenPull; onStart: () => void; starting: boolean }) {
  const canOpen = pull.review !== null && pull.review.phase !== "failed";
  return (
    <div className="pull-actions">
      {pull.draft ? <span className="pull-tag">draft</span> : null}
      {pull.approval ? (
        <span className="pull-tag" data-approval={pull.approval}>
          {pull.approval === "approved" ? "approved" : "changes requested"}
        </span>
      ) : null}
      {pull.review ? <PhaseBadge phase={pull.review.phase} /> : null}
      {canOpen && pull.review ? (
        <Link to={`/reviews/${encodeURIComponent(pull.review.id)}`} className="button quiet">
          Open review
        </Link>
      ) : (
        <button type="button" className="button primary" onClick={onStart} disabled={starting}>
          {pull.review ? "Start again" : "Start review"}
        </button>
      )}
    </div>
  );
}

export function OpenPullList({ pulls }: { pulls: OpenPull[] }) {
  const start = useStartReview();

  if (pulls.length === 0) return <p className="muted">No open pull requests.</p>;

  return (
    <>
      {start.isError ? <p className="error-text small">{errorMessage(start.error)}</p> : null}
      <ul className="pull-list">
        {pulls.map((pull) => (
          <li key={pull.number} className="pull-item">
            <div className="pull-main">
              <a href={pull.url} target="_blank" rel="noreferrer" className="pull-title">
                {pull.title}
              </a>
              <span className="muted small">
                #{pull.number}
                {pull.author ? ` by ${pull.author}` : ""} · {pull.headRef} → {pull.baseRef} · updated {formatRelative(pull.updatedAt)}
              </span>
            </div>
            <PullActions pull={pull} starting={start.isPending} onStart={() => start.mutate(pull.url)} />
          </li>
        ))}
      </ul>
    </>
  );
}

export function useAuthorFilter(): [string, (author: string) => void] {
  const [params, setParams] = useSearchParams();
  const author = params.get("author") ?? "";
  const setAuthor = (next: string) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next) updated.set("author", next);
        else updated.delete("author");
        return updated;
      },
      { replace: true },
    );
  return [author, setAuthor];
}

export function matchesAuthor(pull: OpenPull, author: string): boolean {
  return author === "" || pull.author === author;
}

export function AuthorFilter({ pulls, value, onChange }: { pulls: OpenPull[]; value: string; onChange: (author: string) => void }) {
  const counts = new Map<string, number>();
  for (const pull of pulls) {
    if (pull.author) counts.set(pull.author, (counts.get(pull.author) ?? 0) + 1);
  }
  if (value && !counts.has(value)) counts.set(value, 0);
  const authors = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return (
    <div className="pull-filters">
      <label htmlFor="pull-author">Author</label>
      <select id="pull-author" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Everyone ({pulls.length})</option>
        {authors.map(([author, count]) => (
          <option key={author} value={author}>
            {author} ({count})
          </option>
        ))}
      </select>
      {value ? (
        <button type="button" className="button quiet" onClick={() => onChange("")}>
          Clear
        </button>
      ) : null}
    </div>
  );
}
