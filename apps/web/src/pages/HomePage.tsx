import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import type { ReviewVerdict } from "../api/types";
import { Layout } from "../components/Layout";
import { PastePrForm } from "../components/PastePrForm";
import { PhaseBadge } from "../components/PhaseBadge";
import { RepoForm } from "../components/RepoForm";
import { pullStatus } from "../lib/pulls";
import { formatRelative } from "../lib/time";

type PostedNotice = { count: number; verdict?: ReviewVerdict | null; prNumber: number; prUrl: string; reviewId: string };

function postedSummary(posted: PostedNotice): string {
  const comments = `${posted.count} comment${posted.count === 1 ? "" : "s"}`;
  if (posted.verdict === "approve") return posted.count > 0 ? `Approved and posted ${comments} to` : "Approved";
  if (posted.verdict === "request_changes") return posted.count > 0 ? `Requested changes and posted ${comments} to` : "Requested changes on";
  return `Posted ${comments} to`;
}

function readPosted(state: unknown): PostedNotice | null {
  if (state && typeof state === "object" && "posted" in state) return state.posted as PostedNotice;
  return null;
}

export function HomePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const posted = readPosted(location.state);
  const repos = useQuery({
    queryKey: queryKeys.repos,
    queryFn: api.listRepos,
    refetchInterval: (query) => (query.state.data?.some((repo) => repo.cloneState === "pending") ? 3_000 : false),
  });
  const reviews = useQuery({ queryKey: queryKeys.reviews, queryFn: api.listReviews });
  const pulls = useQuery({ queryKey: queryKeys.pulls, queryFn: api.listAllPulls });
  const allPulls = pulls.data?.flatMap((group) => group.pulls) ?? [];
  const needsReview = allPulls.filter((pull) => !pull.draft && pullStatus(pull) === "needs_review").length;

  return (
    <Layout>
      {posted ? (
        <div className="posted-notice" role="status">
          <span>
            {postedSummary(posted)}{" "}
            <a href={posted.prUrl} target="_blank" rel="noreferrer">
              #{posted.prNumber}
            </a>
            . The agent is now noting what it learned; you can check that on <Link to={`/reviews/${encodeURIComponent(posted.reviewId)}`}>the review</Link>.
          </span>
          <button type="button" className="button quiet" onClick={() => navigate(".", { replace: true, state: null })}>
            Dismiss
          </button>
        </div>
      ) : null}
      <section className="home-section">
        <h1>Start a review</h1>
        <PastePrForm />
      </section>

      <section className="home-section">
        <h2>Open pull requests</h2>
        {pulls.isPending ? <p className="muted">Loading pull requests.</p> : null}
        {pulls.isError ? <p className="error-text">{errorMessage(pulls.error)}</p> : null}
        {pulls.data ? (
          <div className="pulls-teaser">
            <span>
              {allPulls.length} open across {pulls.data.length} {pulls.data.length === 1 ? "repository" : "repositories"}
              {needsReview > 0 ? (
                <>
                  {" · "}
                  <Link to="/pulls?status=needs_review&drafts=hide">{needsReview} need review</Link>
                </>
              ) : null}
            </span>
            <Link to="/pulls" className="button">
              View all pull requests
            </Link>
          </div>
        ) : null}
      </section>

      <section className="home-section">
        <h2>Recent reviews</h2>
        {reviews.isPending ? <p className="muted">Loading reviews.</p> : null}
        {reviews.isError ? <p className="error-text">{errorMessage(reviews.error)}</p> : null}
        {reviews.data && reviews.data.length === 0 ? <p className="muted">No reviews yet.</p> : null}
        {reviews.data && reviews.data.length > 0 ? (
          <ul className="review-list">
            {reviews.data.map((review) => (
              <li key={review.id}>
                <Link to={`/reviews/${encodeURIComponent(review.id)}`} className="review-link">
                  <span className="review-link-title">{review.title}</span>
                  <span className="review-link-meta">
                    {review.repoOwner}/{review.repoName} #{review.prNumber}
                    {review.author ? ` by ${review.author}` : ""} · {formatRelative(review.createdAt)}
                  </span>
                  <PhaseBadge phase={review.phase} />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="home-section">
        <h2>Repositories</h2>
        {repos.isPending ? <p className="muted">Loading repositories.</p> : null}
        {repos.isError ? <p className="error-text">{errorMessage(repos.error)}</p> : null}
        {repos.data && repos.data.length === 0 ? <p className="muted">No repositories set up yet.</p> : null}
        {repos.data && repos.data.length > 0 ? (
          <ul className="repo-list">
            {repos.data.map((repo) => (
              <li key={repo.id} className="repo-item">
                <div className="repo-main">
                  <Link to={`/repos/${encodeURIComponent(repo.id)}`} className="repo-name">
                    {repo.owner}/{repo.name}
                  </Link>
                  <span className="muted small">
                    {repo.defaultBranch} · {repo.skillPath}
                  </span>
                  {repo.cloneError ? <span className="error-text small">{repo.cloneError}</span> : null}
                </div>
                <span className="clone-state" data-state={repo.cloneState}>
                  {repo.cloneState === "pending" ? "cloning" : repo.cloneState}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <details className="add-repo">
          <summary>Add a repository</summary>
          <RepoForm />
        </details>
      </section>
    </Layout>
  );
}
