import fs from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { repos, type Repo } from "../db/schema.js";
import { HttpError } from "../lib/http-error.js";
import { newId } from "../lib/ids.js";
import { clonePathFor, cloneOrFetch, detectDefaultBranch } from "./git.js";
import { parseRepoUrl } from "./github.js";

export type RepoDeps = {
  cloneOrFetch: typeof cloneOrFetch;
  detectDefaultBranch: typeof detectDefaultBranch;
};

const defaultDeps: RepoDeps = { cloneOrFetch, detectDefaultBranch };

function skillPathExists(skillPath: string): boolean {
  if (!path.isAbsolute(skillPath)) return false;
  const stat = fs.statSync(skillPath, { throwIfNoEntry: false });
  if (!stat) return false;
  return stat.isFile() || fs.existsSync(path.join(skillPath, "SKILL.md"));
}

function isDirectory(dir: string): boolean {
  return path.isAbsolute(dir) && fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;
}

const relatedPathsSchema = z
  .array(z.string().trim().min(1).refine(isDirectory, "Each related path must be an absolute path to an existing folder"))
  .transform((paths) => [...new Set(paths)]);

export const createRepoInput = z.object({
  cloneUrl: z
    .string()
    .trim()
    .refine((url) => parseRepoUrl(url) !== null, "cloneUrl must be a GitHub repository URL"),
  kind: z.enum(repos.kind.enumValues).default("other"),
  skillPath: z
    .string()
    .refine(skillPathExists, "skillPath must be an absolute path to a skill file or a directory containing SKILL.md"),
  docsPaths: z.array(z.string().min(1)).default(["CLAUDE.md", "docs"]),
  defaultBranch: z.string().min(1).optional(),
  relatedPaths: relatedPathsSchema.default([]),
});

export const updateRepoInput = z.object({
  relatedPaths: relatedPathsSchema,
});

export type CreateRepoInput = z.infer<typeof createRepoInput>;

export function listRepos(db: Db): Repo[] {
  return db.select().from(repos).orderBy(desc(repos.createdAt)).all();
}

export function getRepo(db: Db, id: string): Repo {
  const repo = db.select().from(repos).where(eq(repos.id, id)).get();
  if (!repo) throw new HttpError(404, "Repo not found");
  return repo;
}

export function createRepo(db: Db, rawInput: unknown, deps: RepoDeps = defaultDeps): Repo {
  const input = createRepoInput.parse(rawInput);
  const parsed = parseRepoUrl(input.cloneUrl);
  if (!parsed) throw new HttpError(400, "cloneUrl must be a GitHub repository URL");

  const existing = db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.owner, parsed.owner), eq(repos.name, parsed.name)))
    .get();
  if (existing) throw new HttpError(409, `Repo ${parsed.owner}/${parsed.name} is already set up`);

  const repo = db
    .insert(repos)
    .values({
      id: newId(),
      owner: parsed.owner,
      name: parsed.name,
      cloneUrl: input.cloneUrl,
      defaultBranch: input.defaultBranch ?? "",
      kind: input.kind,
      skillPath: input.skillPath,
      docsPaths: input.docsPaths,
      relatedPaths: input.relatedPaths,
      clonePath: clonePathFor(parsed.owner, parsed.name),
      cloneState: "pending",
    })
    .returning()
    .get();

  void runClone(db, repo, input.defaultBranch === undefined, deps);
  return repo;
}

export function updateRepo(db: Db, id: string, rawInput: unknown): Repo {
  const input = updateRepoInput.parse(rawInput);
  getRepo(db, id);
  db.update(repos).set({ relatedPaths: input.relatedPaths }).where(eq(repos.id, id)).run();
  return getRepo(db, id);
}

async function runClone(db: Db, repo: Repo, detectBranch: boolean, deps: RepoDeps): Promise<void> {
  try {
    await deps.cloneOrFetch(repo.cloneUrl, repo.clonePath);
    const defaultBranch = detectBranch ? await deps.detectDefaultBranch(repo.clonePath) : repo.defaultBranch;
    db.update(repos).set({ cloneState: "ready", cloneError: null, defaultBranch }).where(eq(repos.id, repo.id)).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.update(repos).set({ cloneState: "failed", cloneError: message }).where(eq(repos.id, repo.id)).run();
  }
}
