import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { docEdits, reviews, type DocEdit, type DocEditStatus, type Repo } from "../db/schema.js";
import { HttpError } from "../lib/http-error.js";
import { git } from "./git.js";
import { createPullRequest } from "./github.js";
import { getRepo } from "./repos.js";

export type DocEditDeps = {
  git: typeof git;
  createPullRequest: typeof createPullRequest;
  now: () => Date;
};

export const defaultDocEditDeps: DocEditDeps = { git, createPullRequest, now: () => new Date() };

export const docsCommitMessage = "docs: updates from code review";

export type DocEditDecision = Extract<DocEditStatus, "approved" | "discarded">;

export function listDocEdits(db: Db, repoId: string): DocEdit[] {
  getRepo(db, repoId);
  return db.select().from(docEdits).where(eq(docEdits.repoId, repoId)).orderBy(desc(docEdits.createdAt)).all();
}

export function setDocEditStatus(db: Db, repoId: string, editId: string, status: DocEditDecision): DocEdit {
  getRepo(db, repoId);
  const existing = db
    .select()
    .from(docEdits)
    .where(and(eq(docEdits.id, editId), eq(docEdits.repoId, repoId)))
    .get();
  if (!existing) throw new HttpError(404, "Doc edit not found");
  if (existing.status === "opened") throw new HttpError(409, "This edit is already in a docs PR");
  return db.update(docEdits).set({ status, error: null }).where(eq(docEdits.id, editId)).returning().get() as DocEdit;
}

export function docsBranchName(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `docs/review-updates-${stamp}`;
}

export function docsPrBody(edits: DocEdit[], reviewUrls: Map<string, string>): string {
  const lines = ["Documentation updates proposed during code review and approved by the reviewer.", ""];
  for (const edit of edits) {
    const source = edit.reviewId ? (reviewUrls.get(edit.reviewId) ?? edit.reviewId) : "manual";
    lines.push(`- \`${edit.path}\`: ${edit.rationale.trim()} (source review: ${source})`);
  }
  return lines.join("\n");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function attributionLine(deps: DocEditDeps, repo: Repo): Promise<string | null> {
  try {
    const { stdout } = await deps.git(["log", "-30", "--format=%b", `origin/${repo.defaultBranch}`], repo.clonePath);
    const match = /^Co-Authored-By: .*$/im.exec(stdout);
    return match ? match[0].trim() : null;
  } catch {
    return null;
  }
}

async function applyEdit(deps: DocEditDeps, repo: Repo, edit: DocEdit): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-review-doc-edit-"));
  const patchFile = path.join(dir, "edit.patch");
  try {
    const diff = edit.diff.endsWith("\n") ? edit.diff : `${edit.diff}\n`;
    await fs.writeFile(patchFile, diff, "utf8");
    await deps.git(["apply", "--3way", patchFile], repo.clonePath);
    await deps.git(["add", "-A"], repo.clonePath);
    await deps.git(["commit", "--quiet", "--allow-empty", "-m", `docs edit ${edit.id}`], repo.clonePath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function openDocsPr(db: Db, repoId: string, deps: DocEditDeps = defaultDocEditDeps): Promise<{ prUrl: string }> {
  const repo = getRepo(db, repoId);
  if (repo.cloneState !== "ready") throw new HttpError(409, `Repo clone is ${repo.cloneState}`);
  const approved = db
    .select()
    .from(docEdits)
    .where(and(eq(docEdits.repoId, repoId), eq(docEdits.status, "approved")))
    .orderBy(asc(docEdits.createdAt))
    .all();
  if (approved.length === 0) throw new HttpError(409, "No approved doc edits to open a PR for");

  const base = repo.defaultBranch;
  const branch = docsBranchName(deps.now());
  await deps.git(["fetch", "origin"], repo.clonePath);
  await deps.git(["checkout", "--quiet", "-b", branch, `origin/${base}`], repo.clonePath);

  const applied: DocEdit[] = [];
  for (const edit of approved) {
    try {
      await applyEdit(deps, repo, edit);
      applied.push(edit);
    } catch (error) {
      await deps.git(["reset", "--quiet", "--hard", "HEAD"], repo.clonePath);
      db.update(docEdits).set({ status: "proposed", error: describe(error) }).where(eq(docEdits.id, edit.id)).run();
    }
  }
  if (applied.length === 0) {
    await deps.git(["checkout", "--quiet", "--detach", `origin/${base}`], repo.clonePath);
    await deps.git(["branch", "--quiet", "-D", branch], repo.clonePath);
    throw new HttpError(409, "None of the approved edits applied cleanly; they are back in the queue with the error shown");
  }

  const attribution = await attributionLine(deps, repo);
  const message = attribution ? `${docsCommitMessage}\n\n${attribution}` : docsCommitMessage;
  await deps.git(["reset", "--quiet", "--soft", `origin/${base}`], repo.clonePath);
  await deps.git(["commit", "--quiet", "-m", message], repo.clonePath);
  await deps.git(["push", "origin", `${branch}:${branch}`], repo.clonePath);

  const reviewUrls = new Map<string, string>();
  for (const row of db.select({ id: reviews.id, prUrl: reviews.prUrl }).from(reviews).all()) reviewUrls.set(row.id, row.prUrl);
  const prUrl = await deps.createPullRequest({
    owner: repo.owner,
    repo: repo.name,
    title: docsCommitMessage,
    head: branch,
    base,
    body: docsPrBody(applied, reviewUrls),
  });

  for (const edit of applied) db.update(docEdits).set({ status: "opened", error: null }).where(eq(docEdits.id, edit.id)).run();
  return { prUrl };
}
