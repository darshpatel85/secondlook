import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Repo, Review } from "../../db/schema.js";
import type { Integration } from "../../integrations.js";
import type { PromptContext } from "./contracts.js";
import { phasePrompts } from "./prompts.js";

const repo: Repo = {
  id: "repo-1",
  owner: "acme",
  name: "widgets-web",
  cloneUrl: "https://github.com/acme/widgets-web.git",
  defaultBranch: "dev",
  kind: "frontend",
  skillPath: "/skills/frontend-review",
  docsPaths: [],
  relatedPaths: [],
  clonePath: "/data/repos/repo-1",
  cloneState: "ready",
  cloneError: null,
  createdAt: new Date(0),
};

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: "review-1",
    repoId: "repo-1",
    prNumber: 7,
    prUrl: "https://github.com/acme/widgets-web/pull/7",
    title: "Stock table",
    body: null,
    author: "bob",
    headRef: "feature/stock-table",
    baseRef: "dev",
    headSha: "deadbeef",
    reviewedSha: null,
    updatedPaths: null,
    verdict: null,
    phase: "context",
    phaseError: null,
    sessionId: "session-1",
    sessionStarted: false,
    worktreePath: "/data/worktrees/review-1",
    jiraKey: null,
    figmaUrl: null,
    intentSummary: null,
    contextChecklist: null,
    contextAutoConfirmed: false,
    approachSummary: null,
    approachObservation: null,
    approachParts: null,
    approachDecision: null,
    reviewerNotes: null,
    staleSteps: [],
    setupWarnings: [],
    postedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

const jiraAndFigma: Integration[] = [
  { name: "atlassian", label: "Jira", server: { type: "http", url: "https://mcp.atlassian.com/v2/mcp" }, guidance: null },
  { name: "figma", label: "Figma", server: { type: "http", url: "https://mcp.figma.com/mcp" }, guidance: null },
];

function makeCtx(overrides: Partial<Review> = {}, integrations: Integration[] = jiraAndFigma): PromptContext {
  return { repo, review: makeReview(overrides), skill: "", docs: [], memory: "", gaps: [], integrations };
}

describe("phasePrompts.context", () => {
  it("asks for the ticket and design when given, then the diff, the intent summary and the gaps", () => {
    const text = phasePrompts.context(makeCtx({ jiraKey: "WID-1", figmaUrl: "https://www.figma.com/design/x/Y" }));
    assert.match(text, /WID-1/);
    assert.match(text, /mcp__atlassian__getJiraIssue/);
    assert.match(text, /https:\/\/www\.figma\.com\/design\/x\/Y/);
    assert.match(text, /mcp__figma__get_design_context/);
    assert.match(text, /git diff origin\/dev\.\.\.HEAD/);
    assert.match(text, /`set_intent_summary` once/);
    assert.match(text, /`add_context_gap` once for each/);
    assert.match(text, /two or three plain sentences/);
    assert.match(text, /Do not propose findings/);
  });

  it("says there is no ticket or design when none is recorded", () => {
    const text = phasePrompts.context(makeCtx());
    assert.match(text, /no ticket for this pull request/);
    assert.match(text, /no design for this pull request/);
    assert.doesNotMatch(text, /mcp__figma/);
  });

  it("skips the ticket and design tools when Jira and Figma are not connected", () => {
    const text = phasePrompts.context(makeCtx({ jiraKey: "WID-1", figmaUrl: "https://www.figma.com/design/x/Y" }, []));
    assert.match(text, /mentions ticket WID-1, but no ticket tracker is connected/);
    assert.match(text, /Figma is not connected/);
    assert.doesNotMatch(text, /mcp__atlassian|mcp__figma|legacy-kb/);
  });
});

describe("phasePrompts.checkpoint", () => {
  it("asks for the full diff, a comparison with the codebase, one set_approach_summary call and no findings", () => {
    const text = phasePrompts.checkpoint(makeCtx());
    assert.match(text, /git diff origin\/dev\.\.\.HEAD/);
    assert.match(text, /solves the same kind of problem elsewhere/);
    assert.match(text, /`set_approach_summary` once/);
    assert.match(text, /one sentence/);
    assert.match(text, /No findings yet/);
  });
});

describe("phasePrompts.approachCorrection", () => {
  it("quotes the note and asks for set_approach_summary again", () => {
    const text = phasePrompts.approachCorrection("The service is new,\nnot a copy.");
    assert.match(text, /> The service is new,\n> not a copy\./);
    assert.match(text, /`set_approach_summary` again/);
  });
});

describe("phasePrompts.approachRejected", () => {
  it("asks for one PR-level blocking finding and includes the note", () => {
    const text = phasePrompts.approachRejected("Use the existing adjustments service.");
    assert.match(text, /`propose_finding` once with no `path`/);
    assert.match(text, /severity `blocking`/);
    assert.match(text, /> Use the existing adjustments service\./);
    assert.match(text, /alternative/);
  });

  it("copes with no note", () => {
    const text = phasePrompts.approachRejected(null);
    assert.match(text, /did not leave a note/);
    assert.doesNotMatch(text, /Their note:/);
    assert.equal(phasePrompts.approachRejected("   ").includes("did not leave a note"), true);
  });
});

describe("phasePrompts.plan", () => {
  it("asks for logical steps, risk, dependency order, skips with reasons, and one set_step_plan call", () => {
    const text = phasePrompts.plan(makeCtx());
    assert.match(text, /git diff --name-status origin\/dev\.\.\.HEAD/);
    assert.match(text, /order the author would have built them/);
    assert.match(text, /risk level/);
    assert.match(text, /by dependency/);
    assert.match(text, /lockfiles/);
    assert.match(text, /`skipReason`/);
    assert.match(text, /`set_step_plan` once/);
    assert.match(text, /review every file up front/);
    assert.match(text, /Call `propose_finding` for each concern/);
    assert.match(text, /Do not wait between files/);
  });
});

describe("phasePrompts.reviewMissedFiles", () => {
  it("lists every missed file with its step and asks for the full file review", () => {
    const text = phasePrompts.reviewMissedFiles([
      { path: "src/a.ts", stepTitle: "Service layer" },
      { path: "src/b.ts", stepTitle: "Routes" },
    ]);
    assert.match(text, /- `src\/a\.ts` \(step "Service layer"\)/);
    assert.match(text, /- `src\/b\.ts` \(step "Routes"\)/);
    assert.match(text, /Call `propose_finding` for each concern/);
    assert.match(text, /`record_file_checked`/);
    assert.match(text, /without waiting between files/);
  });
});

describe("phasePrompts.fileDoneWithoutComments", () => {
  it("offers ask_reviewer for a held concern, else nothing further", () => {
    const text = phasePrompts.fileDoneWithoutComments("src/b.ts");
    assert.match(text, /`src\/b\.ts`/);
    assert.match(text, /`ask_reviewer`/);
    assert.match(text, /nothing further$/);
  });
});

describe("phasePrompts.reviewerComment", () => {
  it("quotes the comment with its line and asks for evidence or agree", () => {
    const text = phasePrompts.reviewerComment({ path: "src/c.ts", line: 12, body: "This can be null." });
    assert.match(text, /`src\/c\.ts` line 12/);
    assert.match(text, /> This can be null\./);
    assert.match(text, /mistaken/);
    assert.match(text, /exactly: agree/);
  });

  it("omits the line when there is none", () => {
    const text = phasePrompts.reviewerComment({ path: "src/c.ts", line: null, body: "Rename this file." });
    assert.match(text, /on `src\/c\.ts`:/);
    assert.doesNotMatch(text, /line null/);
  });
});

describe("phasePrompts.answerQuestion", () => {
  it("quotes both question and answer and says to continue", () => {
    const text = phasePrompts.answerQuestion({ question: "Is this endpoint public?", answer: "No, internal only." });
    assert.match(text, /> Is this endpoint public\?/);
    assert.match(text, /> No, internal only\./);
    assert.match(text, /carry on/);
  });
});

describe("phasePrompts.learn", () => {
  it("asks for at most five memory entries, doc edits where a convention surfaced, and a done reply", () => {
    const text = phasePrompts.learn();
    assert.match(text, /record_memory_entries/);
    assert.match(text, /at most five/);
    assert.match(text, /propose_doc_edit/);
    assert.match(text, /reply in chat with exactly: done$/);
  });
});

describe("phasePrompts shape", () => {
  it("every prompt is a non-empty complete turn", () => {
    const ctx = makeCtx();
    const texts = [
      phasePrompts.context(ctx),
      phasePrompts.checkpoint(ctx),
      phasePrompts.approachCorrection("n"),
      phasePrompts.approachRejected(null),
      phasePrompts.plan(ctx),
      phasePrompts.reviewMissedFiles([{ path: "p", stepTitle: "s" }]),
      phasePrompts.fileDoneWithoutComments("p"),
      phasePrompts.reviewerComment({ path: "p", line: 1, body: "b" }),
      phasePrompts.answerQuestion({ question: "q", answer: "a" }),
      phasePrompts.learn(),
    ];
    for (const text of texts) {
      assert.equal(text.trim().length > 40, true);
      assert.equal(text, text.trim());
    }
  });
});
