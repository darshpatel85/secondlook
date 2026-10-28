import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDb, type Db } from "../db/client.js";
import { repos, reviews, type Repo } from "../db/schema.js";
import { newId } from "../lib/ids.js";
import { pullApproval, type OpenPullRequest } from "./github.js";
import { listAllPulls, listRepoPulls } from "./pulls.js";

function insertRepo(db: Db, name: string): Repo {
  return db
    .insert(repos)
    .values({
      id: newId(),
      owner: "acme",
      name,
      cloneUrl: `https://github.com/acme/${name}`,
      defaultBranch: "main",
      kind: "backend",
      skillPath: "/skills/review.md",
      docsPaths: [],
      clonePath: `/tmp/acme__${name}`,
      cloneState: "ready",
    })
    .returning()
    .get();
}

function insertReview(db: Db, repo: Repo, prNumber: number, createdAt: number, phase: "done" | "review"): string {
  return db
    .insert(reviews)
    .values({
      id: newId(),
      repoId: repo.id,
      prNumber,
      prUrl: `https://github.com/acme/${repo.name}/pull/${prNumber}`,
      title: "Review",
      headRef: "feature/x",
      baseRef: "main",
      headSha: "abc",
      phase,
      sessionId: newId(),
      createdAt: new Date(createdAt),
    })
    .returning()
    .get().id;
}

function pull(number: number): OpenPullRequest {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/widgets/pull/${number}`,
    author: "octocat",
    draft: false,
    headRef: `feature/${number}`,
    baseRef: "main",
    updatedAt: 1_700_000_000_000,
    approval: null,
  };
}

describe("listRepoPulls", () => {
  it("links each open PR to its latest review", async () => {
    const db = openDb(":memory:");
    const repo = insertRepo(db, "widgets");
    insertReview(db, repo, 7, 1_000, "done");
    const latest = insertReview(db, repo, 7, 2_000, "review");

    const pulls = await listRepoPulls(db, repo.id, async (owner, name) => {
      assert.equal(`${owner}/${name}`, "acme/widgets");
      return [pull(7), pull(8)];
    });

    assert.deepEqual(
      pulls.map((item) => [item.number, item.review]),
      [
        [7, { id: latest, phase: "review" }],
        [8, null],
      ],
    );
  });
});

describe("listAllPulls", () => {
  it("keeps going when one repo fails", async () => {
    const db = openDb(":memory:");
    insertRepo(db, "widgets");
    insertRepo(db, "broken");

    const result = await listAllPulls(db, async (_owner, name) => {
      if (name === "broken") throw new Error("Not Found");
      return [pull(1)];
    });

    const byName = Object.fromEntries(result.map((entry) => [entry.name, entry]));
    assert.equal(byName.widgets?.pulls.length, 1);
    assert.equal(byName.widgets?.error, null);
    assert.deepEqual(byName.broken?.pulls, []);
    assert.equal(byName.broken?.error, "Not Found");
  });
});

describe("pullApproval", () => {
  it("uses GitHub's review decision when the repo requires reviews", () => {
    assert.equal(pullApproval("APPROVED", []), "approved");
    assert.equal(pullApproval("CHANGES_REQUESTED", ["APPROVED"]), "changes_requested");
    assert.equal(pullApproval("REVIEW_REQUIRED", ["APPROVED"]), null);
  });

  it("falls back to the latest reviews when the repo does not require reviews", () => {
    assert.equal(pullApproval(null, ["APPROVED", "COMMENTED"]), "approved");
    assert.equal(pullApproval(null, ["APPROVED", "CHANGES_REQUESTED"]), "changes_requested");
    assert.equal(pullApproval(null, []), null);
  });
});
