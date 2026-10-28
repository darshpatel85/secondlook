import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { reviews, type Repo, type Review } from "../db/schema.js";
import { listOpenPullRequests, type OpenPullRequest } from "./github.js";
import { getRepo, listRepos } from "./repos.js";

export type FetchOpenPulls = (owner: string, repo: string) => Promise<OpenPullRequest[]>;

export type OpenPull = OpenPullRequest & { review: { id: string; phase: Review["phase"] } | null };

export type RepoPulls = { repoId: string; owner: string; name: string; pulls: OpenPull[]; error: string | null };

function latestReviewByPr(db: Db, repoId: string): Map<number, Review> {
  const rows = db.select().from(reviews).where(eq(reviews.repoId, repoId)).orderBy(desc(reviews.createdAt)).all();
  const byPr = new Map<number, Review>();
  for (const row of rows) {
    if (!byPr.has(row.prNumber)) byPr.set(row.prNumber, row);
  }
  return byPr;
}

async function pullsFor(db: Db, repo: Repo, fetchPulls: FetchOpenPulls): Promise<OpenPull[]> {
  const pulls = await fetchPulls(repo.owner, repo.name);
  const reviewed = latestReviewByPr(db, repo.id);
  return pulls.map((pull) => {
    const review = reviewed.get(pull.number);
    return { ...pull, review: review ? { id: review.id, phase: review.phase } : null };
  });
}

export async function listRepoPulls(db: Db, repoId: string, fetchPulls: FetchOpenPulls = listOpenPullRequests): Promise<OpenPull[]> {
  return pullsFor(db, getRepo(db, repoId), fetchPulls);
}

export async function listAllPulls(db: Db, fetchPulls: FetchOpenPulls = listOpenPullRequests): Promise<RepoPulls[]> {
  return Promise.all(
    listRepos(db).map(async (repo) => {
      const base = { repoId: repo.id, owner: repo.owner, name: repo.name };
      try {
        return { ...base, pulls: await pullsFor(db, repo, fetchPulls), error: null };
      } catch (error) {
        return { ...base, pulls: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}
