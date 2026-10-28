import { Octokit } from "@octokit/rest";
import { config } from "../config.js";

let client: Octokit | undefined;

async function resolveToken(): Promise<string> {
  if (config.githubToken) return config.githubToken;
  throw new Error("GITHUB_TOKEN is not set: add it to the .env file at the workspace root");
}

export async function github(): Promise<Octokit> {
  if (!client) client = new Octokit({ auth: await resolveToken() });
  return client;
}

export type PrRef = { owner: string; repo: string; number: number };

export function parsePrUrl(url: string): PrRef | null {
  const match = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url.trim());
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}

export function parseRepoUrl(url: string): { owner: string; name: string } | null {
  const trimmed = url.trim();
  const https = /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/.exec(trimmed);
  if (https) return { owner: https[1]!, name: https[2]! };
  const ssh = /^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/.exec(trimmed);
  if (ssh) return { owner: ssh[1]!, name: ssh[2]! };
  return null;
}

export type PullRequestInfo = {
  title: string;
  body: string | null;
  author: string | null;
  headRef: string;
  baseRef: string;
  headSha: string;
};

export async function getPullRequest(ref: PrRef): Promise<PullRequestInfo> {
  const gh = await github();
  const { data } = await gh.pulls.get({ owner: ref.owner, repo: ref.repo, pull_number: ref.number });
  return {
    title: data.title,
    body: data.body ?? null,
    author: data.user?.login ?? null,
    headRef: data.head.ref,
    baseRef: data.base.ref,
    headSha: data.head.sha,
  };
}

export async function createLineComment(
  ref: PrRef,
  input: { body: string; commitId: string; path: string; line: number; startLine?: number },
): Promise<number> {
  const gh = await github();
  const { data } = await gh.pulls.createReviewComment({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.number,
    body: input.body,
    commit_id: input.commitId,
    path: input.path,
    line: input.line,
    side: "RIGHT",
    ...(input.startLine && input.startLine !== input.line ? { start_line: input.startLine, start_side: "RIGHT" as const } : {}),
  });
  return data.id;
}

export async function createFileComment(ref: PrRef, input: { body: string; commitId: string; path: string }): Promise<number> {
  const gh = await github();
  const { data } = await gh.pulls.createReviewComment({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.number,
    body: input.body,
    commit_id: input.commitId,
    path: input.path,
    subject_type: "file",
  });
  return data.id;
}

export type LineRange = [start: number, end: number];

export function diffRanges(patch: string): LineRange[] {
  const ranges: LineRange[] = [];
  for (const match of patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) ranges.push([start, start + count - 1]);
  }
  return ranges;
}

export async function listPullFileRanges(ref: PrRef): Promise<Map<string, LineRange[] | null>> {
  const gh = await github();
  const files = await gh.paginate(gh.pulls.listFiles, { owner: ref.owner, repo: ref.repo, pull_number: ref.number, per_page: 100 });
  return new Map(files.map((file) => [file.filename, file.patch ? diffRanges(file.patch) : null]));
}

export async function createIssueComment(ref: PrRef, body: string): Promise<number> {
  const gh = await github();
  const { data } = await gh.issues.createComment({ owner: ref.owner, repo: ref.repo, issue_number: ref.number, body });
  return data.id;
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export async function submitReview(ref: PrRef, input: { event: ReviewEvent; body: string; commitId: string }): Promise<number> {
  const gh = await github();
  const { data } = await gh.pulls.createReview({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.number,
    commit_id: input.commitId,
    event: input.event,
    ...(input.body ? { body: input.body } : {}),
  });
  return data.id;
}

export type CreatePullRequestInput = { owner: string; repo: string; title: string; head: string; base: string; body: string };

export async function createPullRequest(input: CreatePullRequestInput): Promise<string> {
  const gh = await github();
  const { data } = await gh.pulls.create(input);
  return data.html_url;
}

export type PullApproval = "approved" | "changes_requested" | null;

export type OpenPullRequest = {
  number: number;
  title: string;
  url: string;
  author: string | null;
  draft: boolean;
  headRef: string;
  baseRef: string;
  updatedAt: number;
  approval: PullApproval;
};

type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;

type OpenPullsPage = {
  repository: {
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{
        number: number;
        title: string;
        url: string;
        isDraft: boolean;
        headRefName: string;
        baseRefName: string;
        updatedAt: string;
        author: { login: string } | null;
        reviewDecision: ReviewDecision;
        latestOpinionatedReviews: { nodes: Array<{ state: string } | null> } | null;
      }>;
    };
  };
};

const openPullsQuery = `
  query ($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequests(states: OPEN, first: 100, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          title
          url
          isDraft
          headRefName
          baseRefName
          updatedAt
          author { login }
          reviewDecision
          latestOpinionatedReviews(first: 50) { nodes { state } }
        }
      }
    }
  }
`;

export function pullApproval(decision: ReviewDecision, latestReviewStates: string[]): PullApproval {
  if (decision === "APPROVED") return "approved";
  if (decision === "CHANGES_REQUESTED") return "changes_requested";
  if (decision === "REVIEW_REQUIRED") return null;
  if (latestReviewStates.includes("CHANGES_REQUESTED")) return "changes_requested";
  if (latestReviewStates.includes("APPROVED")) return "approved";
  return null;
}

export async function listOpenPullRequests(owner: string, repo: string): Promise<OpenPullRequest[]> {
  const gh = await github();
  const pulls: OpenPullRequest[] = [];
  let cursor: string | null = null;
  do {
    const page: OpenPullsPage = await gh.graphql<OpenPullsPage>(openPullsQuery, { owner, repo, cursor });
    const { nodes, pageInfo } = page.repository.pullRequests;
    for (const pull of nodes) {
      const states = (pull.latestOpinionatedReviews?.nodes ?? []).flatMap((review) => (review ? [review.state] : []));
      pulls.push({
        number: pull.number,
        title: pull.title,
        url: pull.url,
        author: pull.author?.login ?? null,
        draft: pull.isDraft,
        headRef: pull.headRefName,
        baseRef: pull.baseRefName,
        updatedAt: Date.parse(pull.updatedAt),
        approval: pullApproval(pull.reviewDecision, states),
      });
    }
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);
  return pulls;
}
