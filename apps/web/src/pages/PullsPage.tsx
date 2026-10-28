import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import type { OpenPull } from "../api/types";
import { Layout } from "../components/Layout";
import { PullActions, useStartReview } from "../components/OpenPullList";
import { pullStatus, pullStatuses, pullStatusLabels, type PullStatus } from "../lib/pulls";
import { formatRelative } from "../lib/time";

type Row = OpenPull & { repoId: string; owner: string; repoName: string };

type Filters = { q: string; repo: string; author: string; status: PullStatus | ""; hideDrafts: boolean };

function readFilters(params: URLSearchParams): Filters {
  const status = params.get("status") ?? "";
  return {
    q: params.get("q") ?? "",
    repo: params.get("repo") ?? "",
    author: params.get("author") ?? "",
    status: (pullStatuses as readonly string[]).includes(status) ? (status as PullStatus) : "",
    hideDrafts: params.get("drafts") === "hide",
  };
}

function matches(row: Row, filters: Filters, ignoreStatus = false): boolean {
  if (filters.repo && row.repoId !== filters.repo) return false;
  if (filters.author && row.author !== filters.author) return false;
  if (filters.hideDrafts && row.draft) return false;
  if (!ignoreStatus && filters.status && pullStatus(row) !== filters.status) return false;
  const q = filters.q.trim().toLowerCase();
  if (!q) return true;
  return [row.title, `#${row.number}`, row.headRef, row.author ?? "", row.repoName].some((text) => text.toLowerCase().includes(q));
}

function countBy<T>(items: T[], key: (item: T) => string | null): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function PullsPage() {
  const pulls = useQuery({ queryKey: queryKeys.pulls, queryFn: api.listAllPulls });
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const start = useStartReview();

  const setParam = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const groups = pulls.data ?? [];
  const rows: Row[] = groups
    .flatMap((group) => group.pulls.map((pull) => ({ ...pull, repoId: group.repoId, owner: group.owner, repoName: group.name })))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const failedRepos = groups.filter((group) => group.error);
  const beforeStatus = rows.filter((row) => matches(row, filters, true));
  const visible = beforeStatus.filter((row) => matches(row, filters));
  const statusCounts = new Map(countBy(beforeStatus, pullStatus));
  const authors = countBy(rows, (row) => row.author);
  if (filters.author && !authors.some(([author]) => author === filters.author)) authors.push([filters.author, 0]);
  const filtered = params.toString() !== "";

  return (
    <Layout>
      <section className="home-section">
        <h1>Pull requests</h1>
        <p className="muted small">Open pull requests across every repository you have added, most recently updated first.</p>

        {pulls.isPending ? <p className="muted">Loading pull requests.</p> : null}
        {pulls.isError ? <p className="error-text">{errorMessage(pulls.error)}</p> : null}
        {failedRepos.map((group) => (
          <p key={group.repoId} className="error-text small">
            Could not load {group.owner}/{group.name}: {group.error}
          </p>
        ))}

        {pulls.data ? (
          <>
            <div className="pulls-toolbar">
              <input
                type="search"
                className="pulls-search"
                value={filters.q}
                placeholder="Search title, #number, branch"
                aria-label="Search pull requests"
                onChange={(event) => setParam("q", event.target.value)}
              />
              <select aria-label="Repository" value={filters.repo} onChange={(event) => setParam("repo", event.target.value)}>
                <option value="">All repositories ({groups.length})</option>
                {groups.map((group) => (
                  <option key={group.repoId} value={group.repoId}>
                    {group.owner}/{group.name} ({group.pulls.length})
                  </option>
                ))}
              </select>
              <select aria-label="Author" value={filters.author} onChange={(event) => setParam("author", event.target.value)}>
                <option value="">Everyone</option>
                {authors.map(([author, count]) => (
                  <option key={author} value={author}>
                    {author} ({count})
                  </option>
                ))}
              </select>
            </div>

            <div className="pulls-chips" role="group" aria-label="Status">
              <button
                type="button"
                className="pull-chip"
                aria-pressed={filters.status === ""}
                onClick={() => setParam("status", "")}
              >
                All {beforeStatus.length}
              </button>
              {pullStatuses.map((status) => (
                <button
                  key={status}
                  type="button"
                  className="pull-chip"
                  data-status={status}
                  aria-pressed={filters.status === status}
                  onClick={() => setParam("status", filters.status === status ? "" : status)}
                >
                  {pullStatusLabels[status]} {statusCounts.get(status) ?? 0}
                </button>
              ))}
              <label className="pulls-drafts">
                <input
                  type="checkbox"
                  checked={filters.hideDrafts}
                  onChange={(event) => setParam("drafts", event.target.checked ? "hide" : "")}
                />
                Hide drafts
              </label>
            </div>

            <div className="pulls-summary muted small">
              Showing {visible.length} of {rows.length}
              {filtered ? (
                <button type="button" className="button quiet" onClick={() => setParams({}, { replace: true })}>
                  Clear filters
                </button>
              ) : null}
            </div>

            {start.isError ? <p className="error-text small">{errorMessage(start.error)}</p> : null}

            {groups.length === 0 ? (
              <p className="muted">
                <Link to="/">Add a repository</Link> to see its open pull requests.
              </p>
            ) : visible.length === 0 ? (
              <p className="muted">No pull requests match these filters.</p>
            ) : (
              <ul className="pulls-table">
                {visible.map((row) => (
                  <li key={`${row.repoId}#${row.number}`} className="pulls-row">
                    <Link to={`/repos/${encodeURIComponent(row.repoId)}`} className="pulls-repo" title={`${row.owner}/${row.repoName}`}>
                      {row.repoName}
                    </Link>
                    <div className="pull-main">
                      <a href={row.url} target="_blank" rel="noreferrer" className="pull-title">
                        {row.title}
                      </a>
                      <span className="muted small">
                        #{row.number}
                        {row.author ? ` by ${row.author}` : ""} · {row.headRef} → {row.baseRef} · updated {formatRelative(row.updatedAt)}
                      </span>
                    </div>
                    <PullActions pull={row} starting={start.isPending} onStart={() => start.mutate(row.url)} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </section>
    </Layout>
  );
}
