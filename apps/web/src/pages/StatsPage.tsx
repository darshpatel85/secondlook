import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import type { Stats } from "../api/types";
import { Layout } from "../components/Layout";
import { severityLabels, severityOrder } from "../lib/review";
import { formatRelative } from "../lib/time";

type Tile = {
  key: string;
  label: string;
  value: string;
  target: string;
  definition: string;
  note?: string;
};

function percent(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}

function minutes(value: number | null): string {
  return value === null ? "–" : `${Math.round(value)} min`;
}

function money(value: number | null): string {
  return value === null ? "–" : `$${value.toFixed(2)}`;
}

function tiles(stats: Stats): Tile[] {
  return [
    {
      key: "caught",
      label: "Caught that I missed",
      value: String(stats.caughtThatIMissed),
      target: "Target: at least 1 per medium PR",
      definition: "AI findings that were accepted and posted to the pull request.",
      note: "A proxy until reviewers can mark a finding as one they would have missed.",
    },
    {
      key: "noise",
      label: "AI noise rate",
      value: percent(stats.aiNoiseRate),
      target: "Target: below one third",
      definition: "Rejected AI findings as a share of all AI findings that were posted or rejected.",
    },
    {
      key: "stamp",
      label: "Rubber-stamp rate",
      value: percent(stats.rubberStampRate),
      target: "Target: below one in five",
      definition: "Files in high-risk steps marked done with no reviewer comment and no accepted AI finding.",
      note: "Approximate: chat activity while the file was open is not counted yet.",
    },
    {
      key: "minutes",
      label: "Minutes per review",
      value: minutes(stats.minutesPerReview),
      target: "Target: around 30 min, not rising",
      definition: "Median time from starting a review to posting its comments.",
    },
  ];
}

export function StatsPage() {
  const stats = useQuery({ queryKey: queryKeys.stats, queryFn: api.stats });

  return (
    <Layout>
      <section className="home-section">
        <h1>Stats</h1>
        <p className="muted">The four success measures, computed over reviews whose comments have been posted.</p>
      </section>

      {stats.isPending ? <p className="muted">Loading stats.</p> : null}
      {stats.isError ? <p className="error-text">{errorMessage(stats.error)}</p> : null}

      {stats.data ? (
        <>
          <section className="home-section">
            <div className="stat-tiles">
              {tiles(stats.data).map((tile) => (
                <article key={tile.key} className="stat-tile">
                  <h2 className="stat-label">{tile.label}</h2>
                  <p className="stat-value">{tile.value}</p>
                  <p className="stat-target">{tile.target}</p>
                  <p className="small muted">{tile.definition}</p>
                  {tile.note ? <p className="small muted stat-note">{tile.note}</p> : null}
                </article>
              ))}
            </div>
          </section>

          <section className="home-section">
            <h2>Totals</h2>
            <dl className="facts stat-facts">
              <dt>Posted reviews</dt>
              <dd>{stats.data.reviews}</dd>
              <dt>Findings by severity</dt>
              <dd>
                {severityOrder.map((severity) => `${stats.data.findingsBySeverity[severity]} ${severityLabels[severity]}`).join(" · ")}
              </dd>
              <dt>Agent cost</dt>
              <dd>{money(stats.data.costUsd)}</dd>
            </dl>
          </section>

          <section className="home-section">
            <h2>Reviews</h2>
            {stats.data.perReview.length === 0 ? <p className="muted">No review has been posted yet.</p> : null}
            {stats.data.perReview.length > 0 ? (
              <div className="stat-table-wrap">
                <table className="stat-table">
                  <thead>
                    <tr>
                      <th>Review</th>
                      <th>Posted</th>
                      <th className="num">Minutes</th>
                      <th className="num">AI posted</th>
                      <th className="num">AI rejected</th>
                      <th className="num">AI total</th>
                      <th className="num">Mine</th>
                      <th className="num">Rubber-stamped</th>
                      <th className="num">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.data.perReview.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link to={`/reviews/${encodeURIComponent(row.id)}`}>{row.title}</Link>
                          <span className="muted small stat-row-meta">
                            {row.repoOwner}/{row.repoName} #{row.prNumber}
                          </span>
                        </td>
                        <td className="muted small">{formatRelative(row.postedAt)}</td>
                        <td className="num">{Math.round(row.minutes)}</td>
                        <td className="num">{row.aiPosted}</td>
                        <td className="num">{row.aiRejected}</td>
                        <td className="num">{row.aiFindings}</td>
                        <td className="num">{row.reviewerFindings}</td>
                        <td className="num">
                          {row.rubberStamped}/{row.highRiskFilesDone}
                        </td>
                        <td className="num">{money(row.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </Layout>
  );
}
