import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { openDb, type Db } from "./db/client.js";
import { repos, reviews, type Repo } from "./db/schema.js";
import { newId } from "./lib/ids.js";
import type { RepoDeps } from "./services/repos.js";

const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-skill-"));
fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Skill\n");

const okDeps: RepoDeps = {
  cloneOrFetch: async () => {},
  detectDefaultBranch: async () => "trunk",
};

const failingDeps: RepoDeps = {
  cloneOrFetch: async () => {
    throw new Error("clone exploded");
  },
  detectDefaultBranch: async () => "main",
};

async function waitForCloneState(app: FastifyInstance, id: string, state: Repo["cloneState"]): Promise<Repo> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const res = await app.inject({ method: "GET", url: `/api/repos/${id}` });
    const repo = res.json<Repo>();
    if (repo.cloneState === state) return repo;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`repo ${id} never reached ${state}`);
}

function insertRepo(db: Db, overrides: Partial<typeof repos.$inferInsert> = {}): Repo {
  return db
    .insert(repos)
    .values({
      id: newId(),
      owner: "octocat",
      name: "Hello-World",
      cloneUrl: "https://github.com/octocat/Hello-World",
      defaultBranch: "master",
      kind: "other",
      skillPath: skillDir,
      docsPaths: ["CLAUDE.md"],
      clonePath: "/tmp/octocat__Hello-World",
      cloneState: "ready",
      ...overrides,
    })
    .returning()
    .get();
}

describe("buildApp", () => {
  let db: Db;
  let app: FastifyInstance;

  before(async () => {
    db = openDb(":memory:");
    app = await buildApp({ db, repoDeps: okDeps });
  });

  after(async () => {
    await app.close();
    fs.rmSync(skillDir, { recursive: true, force: true });
  });

  it("answers health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(res.statusCode, 200);
    const body = res.json<{ ok: boolean; version: string }>();
    assert.equal(body.ok, true);
    assert.equal(typeof body.version, "string");
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    assert.equal(res.statusCode, 404);
    assert.equal(typeof res.json<{ error: string }>().error, "string");
  });

  describe("repos", () => {
    it("rejects a non-GitHub clone url", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: { cloneUrl: "https://gitlab.com/a/b", kind: "backend", skillPath: skillDir },
      });
      assert.equal(res.statusCode, 400);
      assert.match(res.json<{ error: string }>().error, /cloneUrl/);
    });

    it("rejects an unknown kind", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: { cloneUrl: "https://github.com/a/b", kind: "mobile", skillPath: skillDir },
      });
      assert.equal(res.statusCode, 400);
      assert.match(res.json<{ error: string }>().error, /kind/);
    });

    it("rejects a skill path that does not exist or is relative", async () => {
      const missing = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: { cloneUrl: "https://github.com/a/b", kind: "backend", skillPath: path.join(skillDir, "missing") },
      });
      assert.equal(missing.statusCode, 400);
      assert.match(missing.json<{ error: string }>().error, /skillPath/);

      const relative = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: { cloneUrl: "https://github.com/a/b", kind: "backend", skillPath: "skills/review" },
      });
      assert.equal(relative.statusCode, 400);
    });

    it("rejects a body that is not an object", async () => {
      const res = await app.inject({ method: "POST", url: "/api/repos", payload: "[]", headers: { "content-type": "application/json" } });
      assert.equal(res.statusCode, 400);
    });

    it("creates a repo, clones in the background and detects the default branch", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: { cloneUrl: "https://github.com/acme/widgets.git", kind: "frontend", skillPath: skillDir },
      });
      assert.equal(res.statusCode, 201);
      const created = res.json<Repo>();
      assert.equal(created.owner, "acme");
      assert.equal(created.name, "widgets");
      assert.equal(created.cloneState, "pending");
      assert.deepEqual(created.docsPaths, ["CLAUDE.md", "docs"]);
      assert.ok(created.clonePath.endsWith("acme__widgets"));

      const ready = await waitForCloneState(app, created.id, "ready");
      assert.equal(ready.defaultBranch, "trunk");
      assert.equal(ready.cloneError, null);
    });

    it("stores related paths on create and replaces them on update", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: { cloneUrl: "https://github.com/acme/related.git", kind: "backend", skillPath: skillDir, relatedPaths: [skillDir, skillDir] },
      });
      assert.equal(res.statusCode, 201);
      const created = res.json<Repo>();
      assert.deepEqual(created.relatedPaths, [skillDir]);

      const cleared = await app.inject({ method: "PATCH", url: `/api/repos/${created.id}`, payload: { relatedPaths: [] } });
      assert.equal(cleared.statusCode, 200);
      assert.deepEqual(cleared.json<Repo>().relatedPaths, []);

      const missing = await app.inject({
        method: "PATCH",
        url: `/api/repos/${created.id}`,
        payload: { relatedPaths: [path.join(skillDir, "missing")] },
      });
      assert.equal(missing.statusCode, 400);
      assert.match(missing.json<{ error: string }>().error, /related path/);

      const relative = await app.inject({ method: "PATCH", url: `/api/repos/${created.id}`, payload: { relatedPaths: ["some/folder"] } });
      assert.equal(relative.statusCode, 400);
    });

    it("keeps a given default branch", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: { cloneUrl: "git@github.com:acme/gadgets.git", kind: "backend", skillPath: skillDir, defaultBranch: "dev" },
      });
      assert.equal(res.statusCode, 201);
      const ready = await waitForCloneState(app, res.json<Repo>().id, "ready");
      assert.equal(ready.defaultBranch, "dev");
    });

    it("rejects a duplicate owner/name with 409", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: { cloneUrl: "https://github.com/acme/widgets", kind: "backend", skillPath: skillDir },
      });
      assert.equal(res.statusCode, 409);
    });

    it("records a failed clone", async () => {
      const failingApp = await buildApp({ db, repoDeps: failingDeps });
      try {
        const res = await failingApp.inject({
          method: "POST",
          url: "/api/repos",
          payload: { cloneUrl: "https://github.com/acme/broken", kind: "other", skillPath: skillDir },
        });
        assert.equal(res.statusCode, 201);
        const failed = await waitForCloneState(failingApp, res.json<Repo>().id, "failed");
        assert.match(failed.cloneError ?? "", /clone exploded/);
      } finally {
        await failingApp.close();
      }
    });

    it("lists repos and fetches one by id", async () => {
      const list = await app.inject({ method: "GET", url: "/api/repos" });
      assert.equal(list.statusCode, 200);
      const items = list.json<Repo[]>();
      assert.ok(items.length >= 3);
      const first = items[0]!;
      const one = await app.inject({ method: "GET", url: `/api/repos/${first.id}` });
      assert.equal(one.statusCode, 200);
      assert.equal(one.json<Repo>().id, first.id);
    });

    it("returns 404 for an unknown repo", async () => {
      const res = await app.inject({ method: "GET", url: "/api/repos/does-not-exist" });
      assert.equal(res.statusCode, 404);
      assert.equal(res.json<{ error: string }>().error, "Repo not found");
    });
  });

  describe("reviews", () => {
    it("returns 404 for an unknown review and its event stream", async () => {
      const detail = await app.inject({ method: "GET", url: "/api/reviews/missing" });
      assert.equal(detail.statusCode, 404);
      assert.equal(detail.json<{ error: string }>().error, "Review not found");

      const events = await app.inject({ method: "GET", url: "/api/reviews/missing/events" });
      assert.equal(events.statusCode, 404);
    });

    it("lists reviews newest first with repo owner and name, and returns detail", async () => {
      const repo = insertRepo(db);
      const base = {
        repoId: repo.id,
        prUrl: "https://github.com/octocat/Hello-World/pull/1",
        headRef: "feature",
        baseRef: "master",
        headSha: "abc123",
        phase: "preparing" as const,
      };
      db.insert(reviews)
        .values({ ...base, id: "r-old", prNumber: 1, title: "Old", sessionId: newId(), createdAt: new Date(1000) })
        .run();
      db.insert(reviews)
        .values({ ...base, id: "r-new", prNumber: 2, title: "New", sessionId: newId(), createdAt: new Date(2000) })
        .run();
      db.insert(reviews)
        .values({ ...base, id: "r-new-older", prNumber: 2, title: "New", sessionId: newId(), createdAt: new Date(1500) })
        .run();

      const list = await app.inject({ method: "GET", url: "/api/reviews" });
      assert.equal(list.statusCode, 200);
      const items = list.json<Array<{ id: string; repoOwner: string; repoName: string; createdAt: number }>>();
      assert.deepEqual(
        items.map((item) => item.id),
        ["r-new", "r-old"],
      );
      assert.equal(items[0]!.repoOwner, "octocat");
      assert.equal(items[0]!.repoName, "Hello-World");
      assert.equal(typeof items[0]!.createdAt, "number");

      const detail = await app.inject({ method: "GET", url: "/api/reviews/r-new" });
      assert.equal(detail.statusCode, 200);
      const body = detail.json<{
        review: { id: string };
        repo: { id: string };
        gaps: unknown[];
        steps: unknown[];
        findings: unknown[];
        questions: unknown[];
        chat: unknown[];
        agentBusy: boolean;
      }>();
      assert.equal(body.review.id, "r-new");
      assert.equal(body.repo.id, repo.id);
      assert.deepEqual([body.gaps, body.steps, body.findings, body.questions, body.chat], [[], [], [], [], []]);
      assert.equal(body.agentBusy, false);
    });
  });

  describe("debug publish", () => {
    it("accepts a publish and validates the body", async () => {
      const ok = await app.inject({
        method: "POST",
        url: "/api/debug/publish/r-new",
        payload: { type: "review.updated", data: { review: { id: "r-new" } } },
      });
      assert.equal(ok.statusCode, 200);

      const bad = await app.inject({ method: "POST", url: "/api/debug/publish/r-new", payload: { data: {} } });
      assert.equal(bad.statusCode, 400);
    });
  });
});
