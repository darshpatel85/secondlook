import type { Api, ConnectionStatus, ReviewEventHandler, StatusHandler } from "./client";
import { ApiError } from "./errors";
import { mockFiles, renderContent, renderPatch, type MockFile } from "./mock-files";
import {
  reviewPhases,
  type ChatMessage,
  type ContextChecklist,
  type ContextGap,
  type ApproachPart,
  type DocEdit,
  type Finding,
  type IntegrationSettings,
  type OpenPull,
  type ProgressState,
  type Repo,
  type Review,
  type ReviewDetail,
  type ReviewEvent,
  type ReviewEventData,
  type ReviewEventType,
  type ReviewListItem,
  type ReviewPhase,
  type RepoPulls,
  type StepFile,
  type StepWithFiles,
} from "./types";

const listeners = new Map<string, Set<ReviewEventHandler>>();

function publish<K extends ReviewEventType>(reviewId: string, type: K, data: ReviewEventData[K]): void {
  const event = { type, data } as ReviewEvent;
  for (const listener of listeners.get(reviewId) ?? []) {
    listener(event);
  }
}

export function subscribeMockEvents(
  reviewId: string,
  onEvent: ReviewEventHandler,
  onStatus: StatusHandler,
): () => void {
  const set = listeners.get(reviewId) ?? new Set<ReviewEventHandler>();
  set.add(onEvent);
  listeners.set(reviewId, set);
  const status: ConnectionStatus = "open";
  onStatus(status);
  return () => {
    set.delete(onEvent);
  };
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter.toString(36).padStart(3, "0")}`;
}

const minutesAgo = (minutes: number): number => Date.now() - minutes * 60_000;
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const latency = (): Promise<void> => wait(120);

function phaseFromUrl(): ReviewPhase | null {
  const raw = new URLSearchParams(window.location.search).get("phase");
  return reviewPhases.find((phase) => phase === raw) ?? null;
}

const repos: Repo[] = [
  {
    id: "repo_api",
    owner: "acme",
    name: "shop-api",
    cloneUrl: "https://github.com/acme/shop-api.git",
    defaultBranch: "main",
    kind: "backend",
    skillPath: ".claude/skills/review/SKILL.md",
    docsPaths: ["docs/conventions.md", "docs/architecture.md"],
    relatedPaths: ["/Users/you/code/shop-web"],
    clonePath: "data/repos/acme__shop-api",
    cloneState: "ready",
    cloneError: null,
    createdAt: minutesAgo(60 * 24 * 3),
  },
  {
    id: "repo_web",
    owner: "acme",
    name: "shop-web",
    cloneUrl: "https://github.com/acme/shop-web.git",
    defaultBranch: "develop",
    kind: "frontend",
    skillPath: ".claude/skills/review/SKILL.md",
    docsPaths: ["docs/CONTRIBUTING.md"],
    relatedPaths: [],
    clonePath: "data/repos/acme__shop-web",
    cloneState: "pending",
    cloneError: null,
    createdAt: minutesAgo(4),
  },
  {
    id: "repo_infra",
    owner: "acme",
    name: "infra",
    cloneUrl: "git@github.com:acme/infra.git",
    defaultBranch: "main",
    kind: "other",
    skillPath: "review/SKILL.md",
    docsPaths: [],
    relatedPaths: [],
    clonePath: "data/repos/acme__infra",
    cloneState: "failed",
    cloneError: "Permission denied (publickey). The server has no SSH key for this host.",
    createdAt: minutesAgo(60 * 5),
  },
];

const apiRepo = repos[0] as Repo;

function baseReview(id: string, phase: ReviewPhase, createdMinutesAgo: number): Review {
  return {
    id,
    repoId: apiRepo.id,
    prNumber: 482,
    prUrl: "https://github.com/acme/shop-api/pull/482",
    title: "Add bulk invoice export for finance",
    body: "Implements SHOP-1234. Finance can now export every invoice in a date range as a single CSV.\n\nDesign: https://www.figma.com/design/abc123/Invoices?node-id=12-40",
    author: "priya-k",
    headRef: "feature/SHOP-1234-bulk-export",
    baseRef: "main",
    headSha: "9f3c2d1a7b6e5f4c3d2e1f0a9b8c7d6e5f4a3b2c",
    reviewedSha: null,
    updatedPaths: null,
    verdict: null,
    phase,
    phaseError: null,
    sessionId: "sess_mock_0001",
    sessionStarted: phase !== "preparing",
    worktreePath: phase === "preparing" ? null : "data/worktrees/acme__shop-api/482",
    jiraKey: "SHOP-1234",
    figmaUrl: "https://www.figma.com/design/abc123/Invoices?node-id=12-40",
    intentSummary: null,
    approachSummary: null,
    approachObservation: null,
    approachParts: null,
    approachDecision: null,
    contextChecklist: null,
    contextAutoConfirmed: false,
    reviewerNotes: null,
    staleSteps: [],
    setupWarnings: [],
    postedAt: null,
    createdAt: minutesAgo(createdMinutesAgo),
    updatedAt: minutesAgo(1),
  };
}

const intentSummary =
  "The PR lets finance users export every invoice in a chosen date range as one CSV file. It adds an export endpoint, a background job that streams rows from the invoices table, and an email with a signed download link when the job finishes. The ticket asks for a 50,000 row cap per export, which the PR description does not mention.";

const approachSummary = "Works end to end; one concern: the job skips the shared streaming base class (part 2).";

const approachParts: ApproachPart[] = [
  {
    title: "Export endpoint",
    points: ["`POST /invoices/export` enqueues the job and returns `202` with a job id."],
    observations: [],
  },
  {
    title: "`ExportJob` worker",
    points: [
      "New `export_jobs` table tracks each run.",
      "Pages through `invoices` 500 rows at a time.",
      "Writes each page to a temp CSV, then uploads it to object storage.",
    ],
    observations: [
      {
        verdict: "concern",
        title: "Skips the shared job base class",
        points: [
          "Other long-running jobs extend `BaseStreamingJob` and report through `JobProgress` (`app/jobs/reconciliation_job.rb:4`, `app/jobs/statement_job.rb:6`).",
          "`ExportJob` re-implements paging and progress by hand, so `admin/jobs` will not show it.",
          "Alternative: extend `BaseStreamingJob` and drop the hand-written paging.",
        ],
        checkInReview: true,
      },
    ],
  },
  {
    title: "Completion email",
    points: ["Reuses `InvoiceMailer` with a new `export_ready` template and a signed download link."],
    observations: [{ verdict: "fits", title: "Matches existing mailers", points: ["Same pattern as `StatementMailer` (`app/mailers/statement_mailer.rb`)."] }],
  },
];

function gap(reviewId: string, question: string, answer: string | null, ageMinutes: number): ContextGap {
  return { id: nextId("gap"), reviewId, question, answer, createdAt: minutesAgo(ageMinutes) };
}

function message(reviewId: string, role: ChatMessage["role"], content: string, ageMinutes: number): ChatMessage {
  return { id: nextId("msg"), reviewId, role, content, createdAt: minutesAgo(ageMinutes) };
}

const mockChecklist: ContextChecklist = {
  consumers: {
    status: "known",
    summary: "The new endpoint has no callers yet; the finance frontend adds the button in a separate PR. `Invoice.issued_between` is also used by the monthly statement job.",
    evidence: ["app/jobs/statement_job.rb:31", "web-app: apps/finance/src/api/exports.ts (not yet merged)"],
  },
  data: {
    status: "known",
    summary: "Adds the `export_jobs` table. Reads `invoices` only. The migration is reversible.",
    evidence: ["db/migrate/20260914_create_export_jobs.rb:3"],
  },
  legacy: { status: "not_applicable", summary: "New feature with no legacy screen.", evidence: [] },
  acceptance: [
    { criterion: "Finance can export invoices in a date range as CSV", status: "covered", coveredBy: "app/jobs/invoice_export_job.rb" },
    { criterion: "User gets an email with a download link", status: "covered", coveredBy: "app/mailers/invoice_mailer.rb" },
    { criterion: "Exports are capped at 50,000 rows", status: "unclear", question: "Is the 50,000 row cap a hard failure or should the export truncate and warn?" },
  ],
};

function buildSteps(reviewId: string): StepWithFiles[] {
  const stepOne = nextId("step");
  const stepTwo = nextId("step");
  const stepThree = nextId("step");
  const file = (stepId: string, position: number, path: string, state: ProgressState, skip?: string): StepFile => ({
    id: nextId("file"),
    reviewId,
    stepId,
    position,
    path,
    skipped: skip !== undefined,
    skipReason: skip ?? null,
    state,
    checked: state === "done" ? (mockFiles[path]?.checked ?? null) : null,
  });
  return [
    {
      id: stepOne,
      reviewId,
      position: 0,
      title: "Export job and storage",
      purpose: "Create the job model, worker and CSV writer",
      risk: "high",
      kind: "code",
      reviewMode: "as_you_go",
      routing: "full",
      riskReason: "`db/migrate/20260914_create_export_jobs.rb` changes the database schema",
      state: "in_progress",
      files: [
        file(stepOne, 0, "db/migrate/20260914_create_export_jobs.rb", "done"),
        file(stepOne, 1, "app/models/export_job.rb", "done"),
        file(stepOne, 2, "app/jobs/invoice_export_job.rb", "in_progress"),
        file(stepOne, 3, "db/schema.rb", "not_started", "generated schema dump"),
      ],
    },
    {
      id: stepTwo,
      reviewId,
      position: 1,
      title: "Endpoint and email",
      purpose: "Expose the export and tell the user when it is ready",
      risk: "medium",
      kind: "code",
      reviewMode: "look_first",
      routing: "findings",
      riskReason: null,
      state: "not_started",
      files: [
        file(stepTwo, 0, "app/controllers/api/invoice_exports_controller.rb", "not_started"),
        file(stepTwo, 1, "app/mailers/invoice_mailer.rb", "not_started"),
        file(stepTwo, 2, "app/views/invoice_mailer/export_ready.html.erb", "not_started"),
        file(stepTwo, 3, "spec/requests/invoice_exports_spec.rb", "not_started"),
      ],
    },
    {
      id: stepThree,
      reviewId,
      position: 2,
      title: "Copy and config",
      purpose: "Email wording, locale strings and the feature flag",
      risk: "low",
      kind: "code",
      reviewMode: "as_you_go",
      routing: "auto",
      riskReason: null,
      state: "not_started",
      files: [
        { ...file(stepThree, 0, "config/locales/en.yml", "not_started"), checked: ["Keys match the mailer", "No removed keys"] },
        { ...file(stepThree, 1, "config/features.yml", "not_started"), checked: ["Flag defaults to off"] },
        { ...file(stepThree, 2, "app/views/invoice_mailer/export_ready.text.erb", "not_started"), checked: ["Matches the HTML template"] },
      ],
    },
  ];
}

function buildFindings(reviewId: string, posted: boolean): Finding[] {
  const finding = (
    partial: Pick<Finding, "path" | "line" | "origin" | "severity" | "title" | "body" | "status"> & Partial<Finding>,
  ): Finding => ({
    id: nextId("finding"),
    reviewId,
    endLine: null,
    evidence: null,
    confidence: "medium",
    rejectReason: null,
    agentChallenge: null,
    verification: null,
    verifierNote: null,
    githubCommentId: null,
    createdAt: minutesAgo(12),
    updatedAt: minutesAgo(2),
    ...partial,
    ...(posted ? { status: "posted" as const, githubCommentId: 1_900_000_000 + counter } : {}),
  });
  return [
    finding({
      path: "app/jobs/invoice_export_job.rb",
      line: 37,
      endLine: 44,
      origin: "ai",
      severity: "blocking",
      title: "Export ignores the 50,000 row cap from the ticket",
      body: "The ticket caps each export at 50,000 rows, but the loop pages until the relation is empty. A large tenant can produce a multi-gigabyte file and hold the worker for hours. The gap answer says to truncate at 50,000 and add a warning line to the email.",
      evidence: "SHOP-1234 acceptance criteria, third bullet. The loop at lines 37 to 44 has no counter and nothing reads rows_written back.",
      confidence: "high",
      status: "proposed",
      verification: "confirmed",
      verifierNote: "Checked the loop at `invoice_export_job.rb:37` and its callers; nothing stops at 50,000 rows, so the problem holds.",
    }),
    finding({
      path: "app/jobs/invoice_export_job.rb",
      line: 21,
      origin: "ai",
      severity: "should_fix",
      title: "Export may include other tenants' invoices",
      body: "This query does not filter by tenant, so an export could include invoices from other tenants. Scope it with `tenant_id`.",
      evidence: "invoice_export_job.rb:21 builds `Invoice.where(status:)` with no tenant filter.",
      confidence: "medium",
      status: "proposed",
      verification: "refuted",
      verifierNote: "`Invoice` has a default scope on `Current.tenant` (`app/models/invoice.rb:4`), so the query is already limited to one tenant.",
    }),
    finding({
      path: "app/jobs/invoice_export_job.rb",
      line: 52,
      origin: "ai",
      severity: "nit",
      title: "CSV header order differs from the design",
      body: "The design lists the amount column before the due date.",
      confidence: "low",
      status: "proposed",
      verification: "pending",
    }),
    finding({
      path: "app/jobs/invoice_export_job.rb",
      line: 64,
      origin: "ai",
      severity: "should_fix",
      title: "Temp file is not removed when upload fails",
      body: "If Storage.put raises, the ensure block only closes the file. Tempfile#close! or unlink is needed here, or the worker's disk fills over time.",
      evidence: "Compare StatementJob#cleanup at app/jobs/statement_job.rb:72.",
      confidence: "medium",
      status: "accepted",
    }),
    finding({
      path: "app/models/export_job.rb",
      line: 12,
      origin: "ai",
      severity: "nit",
      title: "Status enum could reuse JobStatus",
      body: "The other job models share JobStatus from app/models/concerns. Defining a fresh enum means a fourth spelling of 'in progress'.",
      confidence: "low",
      status: "rejected",
      rejectReason: "Agreed in principle, but the concern is being removed next sprint.",
    }),
    finding({
      path: "app/models/export_job.rb",
      line: 30,
      origin: "reviewer",
      severity: "question",
      title: "Index on requested_by?",
      body: "Will the admin list filter by requester? If so we want an index on requested_by before this ships.",
      status: "accepted",
    }),
  ];
}

function buildDetail(id: string, phase: ReviewPhase): ReviewDetail {
  const review = baseReview(id, phase, 35);
  const detail: ReviewDetail = {
    review,
    repo: apiRepo,
    gaps: [],
    steps: [],
    findings: [],
    questions: [],
    chat: [],
    activity: [],
    agentBusy: false,
  };

  if (phase === "preparing") {
    return detail;
  }

  if (phase === "failed") {
    review.phaseError = "git fetch failed: fatal: could not read from remote repository (exit 128)";
    detail.chat.push(message(id, "system", "The review could not be prepared. Fix the clone and start again.", 3));
    return detail;
  }

  review.intentSummary = intentSummary;
  review.contextChecklist = mockChecklist;
  detail.gaps.push(
    gap(id, "Should the export include voided invoices, or only issued and paid ones?", "Only issued and paid. Voided invoices stay out of finance reports.", 20),
    gap(id, "Is the 50,000 row cap a hard failure or should the export truncate and warn?", null, 19),
  );
  detail.chat.push(
    message(id, "agent", "I have read the ticket, the Figma frame and the diff. The intent summary is up. Two things the ticket does not settle are listed as gaps.", 21),
    message(id, "reviewer", "Thanks. The voided question is answered; still checking with finance on the cap.", 18),
  );

  if (phase === "context") {
    return detail;
  }

  for (const item of detail.gaps) {
    item.answer ??= "Truncate at 50,000 and add a warning line to the email.";
  }
  review.reviewerNotes = "Priya is new to the jobs framework; be concrete about which base class to use.";
  review.approachSummary = approachSummary;
  review.approachParts = approachParts;
  detail.chat.push(message(id, "agent", "Approach summary recorded. The observation about BaseStreamingJob is worth a look before we plan the steps.", 15));

  if (phase === "checkpoint") {
    return detail;
  }

  review.approachDecision = "proceed";
  detail.chat.push(message(id, "reviewer", "Proceed. Flag the base class divergence as a should_fix when you get to the job.", 14));

  if (phase === "planning") {
    detail.agentBusy = true;
    return detail;
  }

  detail.steps = buildSteps(id);
  detail.findings = buildFindings(id, phase === "done");
  detail.questions.push({
    id: nextId("q"),
    reviewId: id,
    path: "app/jobs/invoice_export_job.rb",
    question: "Does object storage in production have lifecycle rules, or should the job delete the file after the link expires?",
    answer: null,
    createdAt: minutesAgo(9),
  });
  detail.chat.push(
    message(id, "agent", "Step plan is in. Two steps, the job first because the endpoint is a thin wrapper around it.", 13),
    message(id, "agent", "First finding on the job: the 50,000 cap from the ticket is missing. Evidence is on the card.", 10),
  );

  if (phase === "review") {
    return detail;
  }

  for (const step of detail.steps) {
    step.state = "done";
    for (const file of step.files) {
      if (!file.skipped) {
        file.state = "done";
      }
    }
  }
  detail.chat.push(message(id, "reviewer", "Posting the accepted comments now.", 5));

  if (phase === "posting") {
    return detail;
  }

  review.postedAt = minutesAgo(4);
  detail.chat.push(
    message(id, "agent", "Posted. I recorded two memory entries: you prefer concrete base-class pointers for new contributors, and voided invoices stay out of finance exports.", 3),
  );
  return detail;
}

const details = new Map<string, ReviewDetail>();

const seededReviews: ReviewListItem[] = [
  { ...baseReview("rev_done", "done", 60 * 26), repoOwner: "acme", repoName: "shop-api", title: "Fix rounding on partial refunds", prNumber: 471, prUrl: "https://github.com/acme/shop-api/pull/471", postedAt: minutesAgo(60 * 25) },
  { ...baseReview("rev_review", "review", 60 * 3), repoOwner: "acme", repoName: "shop-api", prNumber: 479, prUrl: "https://github.com/acme/shop-api/pull/479", title: "Retry webhook deliveries with backoff" },
  { ...baseReview("rev_context", "context", 35), repoOwner: "acme", repoName: "shop-api" },
];

function mockPullsFor(repo: Repo): OpenPull[] {
  if (repo.id !== apiRepo.id) return [];
  const reviewed = new Map([...createdReviews, ...seededReviews].filter((item) => item.repoId === repo.id).map((item) => [item.prNumber, item]));
  const pull = (number: number, title: string, author: string, ageMinutes: number, draft = false, approval: OpenPull["approval"] = null): OpenPull => {
    const review = reviewed.get(number);
    return {
      number,
      title,
      url: `https://github.com/${repo.owner}/${repo.name}/pull/${number}`,
      author,
      draft,
      headRef: `feature/pr-${number}`,
      baseRef: repo.defaultBranch,
      updatedAt: minutesAgo(ageMinutes),
      approval,
      review: review ? { id: review.id, phase: review.phase } : null,
    };
  };
  return [
    pull(479, "Retry webhook deliveries with backoff", "mona", 40),
    pull(482, "Add CSV export for invoices", "hubot", 90, false, "approved"),
    pull(485, "Spike: move jobs to a queue", "octocat", 60 * 5, true),
  ];
}

const createdReviews: ReviewListItem[] = [];

function defaultPhase(id: string): ReviewPhase {
  const listed = [...createdReviews, ...seededReviews].find((item) => item.id === id);
  return listed?.phase ?? "context";
}

function resolveDetail(id: string): ReviewDetail {
  const requested = phaseFromUrl();
  const key = requested ? `${id}|${requested}` : id;
  let detail = details.get(key);
  if (!detail) {
    detail = buildDetail(id, requested ?? defaultPhase(id));
    details.set(key, detail);
  }
  return detail;
}

function touch(detail: ReviewDetail): void {
  detail.review.updatedAt = Date.now();
}

function pushAgentMessage(detail: ReviewDetail, content: string): void {
  const msg: ChatMessage = { id: nextId("msg"), reviewId: detail.review.id, role: "agent", content, createdAt: Date.now() };
  detail.chat.push(msg);
  publish(detail.review.id, "chat.message", { message: msg });
}

function setBusy(detail: ReviewDetail, busy: boolean): void {
  detail.agentBusy = busy;
  touch(detail);
  publish(detail.review.id, "review.updated", { review: detail.review });
}

async function agentTurn(detail: ReviewDetail, steps: Array<() => void>, gapMs = 900): Promise<void> {
  setBusy(detail, true);
  for (const step of steps) {
    await wait(gapMs);
    step();
  }
  setBusy(detail, false);
  publish(detail.review.id, "agent.turn_done", { costUsd: 0.04, durationMs: gapMs * steps.length });
}

function activity(detail: ReviewDetail, tool: string, summary: string): void {
  publish(detail.review.id, "agent.activity", { tool, summary });
}

function simulatePreparation(detail: ReviewDetail): void {
  const { review } = detail;
  const id = review.id;
  void (async () => {
    await wait(1_800);
    review.phase = "context";
    review.sessionStarted = true;
    review.worktreePath = "data/worktrees/acme__shop-api/482";
    touch(detail);
    publish(id, "review.updated", { review });
    await agentTurn(detail, [
      () => activity(detail, "atlassian.getJiraIssue", "SHOP-1234"),
      () => activity(detail, "Bash", "git diff origin/main...HEAD --stat"),
      () => {
        activity(detail, "set_intent_summary", "4 sentences");
        review.intentSummary = intentSummary;
        touch(detail);
        publish(id, "review.updated", { review });
      },
      () => {
        const added = gap(id, "Is the 50,000 row cap a hard failure or should the export truncate and warn?", null, 0);
        detail.gaps.push(added);
        activity(detail, "add_context_gap", added.question);
        publish(id, "gap.added", { gap: added });
      },
      () => pushAgentMessage(detail, "Ticket, design and diff are read. The intent summary is up and there is one gap I could not settle from the ticket."),
    ]);
  })();
}

function requirePhase(detail: ReviewDetail, phase: ReviewPhase): void {
  if (detail.review.phase !== phase) {
    throw new ApiError(409, `review is in phase ${detail.review.phase}, expected ${phase}`);
  }
}

const reviewedPaths = new WeakMap<ReviewDetail, Set<string>>();

function reviewedSet(detail: ReviewDetail): Set<string> {
  let set = reviewedPaths.get(detail);
  if (!set) {
    set = new Set(
      detail.steps
        .flatMap((step) => step.files)
        .filter((file) => file.state !== "not_started")
        .map((file) => file.path),
    );
    reviewedPaths.set(detail, set);
  }
  return set;
}

function findFile(detail: ReviewDetail, fileId: string): { step: StepWithFiles; file: StepFile } {
  for (const step of detail.steps) {
    const file = step.files.find((item) => item.id === fileId);
    if (file) {
      return { step, file };
    }
  }
  throw new ApiError(404, "file not found");
}

const fallbackFile: MockFile = {
  status: "modified",
  hunks: [{ oldStart: 1, newStart: 1, lines: [" line one", "-line two", "+line two changed", "+line three added", " line four"] }],
  findings: [],
  checked: ["nothing of note"],
};

function fixtureFor(path: string): MockFile {
  return mockFiles[path] ?? fallbackFile;
}

function hasComments(detail: ReviewDetail, path: string): boolean {
  return detail.findings.some(
    (finding) =>
      finding.path === path &&
      ((finding.origin !== "ai" && finding.status !== "rejected") ||
        (finding.origin === "ai" && (finding.status === "accepted" || finding.status === "posted"))),
  );
}

function fileReviewSteps(detail: ReviewDetail, file: StepFile): { steps: Array<() => void>; count: number } {
  const reviewId = detail.review.id;
  const fixture = fixtureFor(file.path);
  const findingSteps = fixture.findings.map((scripted) => () => {
    const finding: Finding = {
      id: nextId("finding"),
      reviewId,
      path: file.path,
      line: scripted.line,
      endLine: null,
      origin: "ai",
      severity: scripted.severity,
      title: scripted.title,
      body: scripted.body,
      evidence: scripted.evidence,
      confidence: scripted.confidence,
      status: "proposed",
      rejectReason: null,
      agentChallenge: null,
      verification: null,
      verifierNote: null,
      githubCommentId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    detail.findings.push(finding);
    activity(detail, "propose_finding", `${scripted.severity} at ${file.path}:${scripted.line}`);
    publish(reviewId, "finding.added", { finding });
  });
  return {
    count: fixture.findings.length,
    steps: [
      () => activity(detail, "Read", file.path),
      ...findingSteps,
      () => {
        file.checked = fixture.checked;
        activity(detail, "record_file_checked", `${fixture.checked.length} items`);
        publish(reviewId, "file.updated", { file });
      },
    ],
  };
}

function simulateFileReview(detail: ReviewDetail, file: StepFile): void {
  const { steps, count } = fileReviewSteps(detail, file);
  const summary =
    count === 0 ? `Nothing to raise on ${file.path}. The checked list says what I looked at.` : `${count} finding${count === 1 ? "" : "s"} on ${file.path}.`;
  void agentTurn(detail, [...steps, () => pushAgentMessage(detail, summary)], 700);
}

function simulateUpfrontReview(detail: ReviewDetail): void {
  const files = detail.steps.flatMap((step) => (step.kind === "code" ? step.files.filter((file) => !file.skipped && file.checked === null) : []));
  const runs = files.map((file) => fileReviewSteps(detail, file));
  const total = runs.reduce((sum, run) => sum + run.count, 0);
  void agentTurn(
    detail,
    [...runs.flatMap((run) => run.steps), () => pushAgentMessage(detail, `Reviewed ${files.length} files up front and raised ${total} findings.`)],
    500,
  );
}

function nudgeAfterDone(detail: ReviewDetail, file: StepFile): void {
  if (hasComments(detail, file.path) || detail.agentBusy) {
    return;
  }
  const proposed = detail.findings.filter((item) => item.path === file.path && item.status === "proposed").length;
  const text =
    proposed > 0
      ? `You marked ${file.path} done without comments while ${proposed} of my findings there ${proposed === 1 ? "is" : "are"} still proposed. Worth a decision on each before posting.`
      : `${file.path} is done with no comments. If anything there gave you pause, say so and I will dig in.`;
  void agentTurn(detail, [() => pushAgentMessage(detail, text)], 500);
}

const memoryHeadings = ["## Review preferences", "## Recurring patterns", "## Corrections to the agent", "## Author notes"];

const memoryBefore = [
  "## Review preferences",
  "",
  "- Prefers concrete file pointers over general advice.",
  "- Keep nits out of the posted comments unless asked.",
  "",
  "## Recurring patterns",
  "",
  "- Background jobs often skip BaseStreamingJob and lose dashboard progress.",
  "",
  "## Corrections to the agent",
  "",
  "## Author notes",
  "",
].join("\n");

const memoryAfter = [
  "## Review preferences",
  "",
  "- Prefers concrete file pointers over general advice.",
  "- Keep nits out of the posted comments unless asked.",
  "- Wants a named base class suggested whenever a new contributor adds a job.",
  "",
  "## Recurring patterns",
  "",
  "- Background jobs often skip BaseStreamingJob and lose dashboard progress.",
  "- Temp files from exports are not cleaned up on failure.",
  "",
  "## Corrections to the agent",
  "",
  "## Author notes",
  "",
  "- Voided invoices stay out of finance exports (priya-k, SHOP-1234).",
  "",
].join("\n");

const memoryStore = new Map<string, string>([[apiRepo.id, memoryAfter]]);

function memoryFor(repoId: string): string {
  return memoryStore.get(repoId) ?? `${memoryHeadings.join("\n\n")}\n`;
}

const docEditStore: DocEdit[] = [
  {
    id: nextId("edit"),
    repoId: apiRepo.id,
    reviewId: "rev_done",
    path: "docs/conventions.md",
    diff: [
      "--- a/docs/conventions.md",
      "+++ b/docs/conventions.md",
      "@@ -12,3 +12,5 @@",
      " ## Background jobs",
      " ",
      " Every long-running job extends BaseStreamingJob.",
      "+Report progress through JobProgress so the admin dashboard can show it.",
      "+Clean up temp files in an ensure block, even when the upload fails.",
    ].join("\n"),
    rationale: "Two reviews in a row hit the same gap: the conventions page says which base class to use but not why, so new contributors skip it.",
    status: "proposed",
    error: null,
    createdAt: minutesAgo(60 * 25),
  },
  {
    id: nextId("edit"),
    repoId: apiRepo.id,
    reviewId: "rev_done",
    path: "docs/architecture.md",
    diff: [
      "--- a/docs/architecture.md",
      "+++ b/docs/architecture.md",
      "@@ -40,2 +40,3 @@",
      " Exports are written to object storage with a signed link.",
      "+Signed links expire after 24 hours; lifecycle rules delete the file after 7 days.",
    ].join("\n"),
    rationale: "The reviewer answered the agent's question about storage lifecycle and the answer is not written down anywhere.",
    status: "proposed",
    error: "error: patch failed: docs/architecture.md:40",
    createdAt: minutesAgo(60 * 24),
  },
  {
    id: nextId("edit"),
    repoId: apiRepo.id,
    reviewId: null,
    path: "docs/conventions.md",
    diff: ["--- a/docs/conventions.md", "+++ b/docs/conventions.md", "@@ -1,2 +1,2 @@", "-# Conventions", "+# Conventions for shop-api"].join("\n"),
    rationale: "Title clarity.",
    status: "discarded",
    error: null,
    createdAt: minutesAgo(60 * 48),
  },
  {
    id: nextId("edit"),
    repoId: apiRepo.id,
    reviewId: "rev_review",
    path: "CLAUDE.md",
    diff: ["--- a/CLAUDE.md", "+++ b/CLAUDE.md", "@@ -5,2 +5,3 @@", " ## Testing", "+Webhook retries are covered by spec/jobs/webhook_retry_spec.rb."].join("\n"),
    rationale: "Points reviewers at the retry spec that already exists.",
    status: "opened",
    error: null,
    createdAt: minutesAgo(60 * 72),
  },
];

let mockIntegrations: IntegrationSettings = { jira: { siteUrl: "https://example.atlassian.net" }, figma: {}, servers: {} };

export const mockApi: Api = {
  async health() {
    await latency();
    return { ok: true, version: "mock" };
  },

  async mcpStatus() {
    await latency();
    return {
      servers: [
        { name: "atlassian", label: "Jira", status: "connected" },
        { name: "figma", label: "Figma", status: "needs-auth" },
      ],
      checkedAt: Date.now(),
    };
  },

  async integrations() {
    await latency();
    return { settings: mockIntegrations, signInCommand: "claude --mcp-config data/mcp-template.json --strict-mcp-config" };
  },

  async saveIntegrations(settings) {
    await latency();
    mockIntegrations = settings;
    return { settings, signInCommand: "claude --mcp-config data/mcp-template.json --strict-mcp-config" };
  },

  async claudeAuth() {
    await latency();
    return { loggedIn: true, authMethod: "claude.ai", login: { running: false, url: null, error: null, startedAt: null } };
  },

  async startClaudeLogin() {
    await latency();
    return { login: { running: true, url: null, error: null, startedAt: Date.now() } };
  },

  async listRepos() {
    await latency();
    return structuredClone(repos);
  },

  async createRepo(input) {
    await latency();
    const match = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(input.cloneUrl);
    if (!match) {
      throw new ApiError(400, "cloneUrl must be a GitHub clone URL");
    }
    const repo: Repo = {
      id: nextId("repo"),
      owner: match[1] ?? "unknown",
      name: match[2] ?? "unknown",
      cloneUrl: input.cloneUrl,
      defaultBranch: input.defaultBranch ?? "main",
      kind: input.kind ?? "other",
      skillPath: input.skillPath,
      docsPaths: input.docsPaths ?? [],
      relatedPaths: input.relatedPaths ?? [],
      clonePath: `data/repos/${match[1]}__${match[2]}`,
      cloneState: "pending",
      cloneError: null,
      createdAt: Date.now(),
    };
    repos.push(repo);
    void wait(2_500).then(() => {
      repo.cloneState = "ready";
    });
    return structuredClone(repo);
  },

  async updateRepoRelatedPaths(id, relatedPaths) {
    await latency();
    const repo = repos.find((item) => item.id === id);
    if (!repo) {
      throw new ApiError(404, "repo not found");
    }
    if (relatedPaths.some((dir) => !dir.startsWith("/"))) {
      throw new ApiError(400, "Each related path must be an absolute path to an existing folder");
    }
    repo.relatedPaths = [...new Set(relatedPaths)];
    return structuredClone(repo);
  },

  async getRepo(id) {
    await latency();
    const repo = repos.find((item) => item.id === id);
    if (!repo) {
      throw new ApiError(404, "repo not found");
    }
    return structuredClone(repo);
  },

  async listRepoPulls(repoId) {
    await latency();
    const repo = repos.find((item) => item.id === repoId);
    if (!repo) {
      throw new ApiError(404, "repo not found");
    }
    return mockPullsFor(repo);
  },

  async listAllPulls() {
    await latency();
    return repos.map(
      (repo): RepoPulls => ({ repoId: repo.id, owner: repo.owner, name: repo.name, pulls: mockPullsFor(repo), error: null }),
    );
  },

  async listReviews() {
    await latency();
    return structuredClone([...createdReviews, ...seededReviews]);
  },

  async getReview(id) {
    await latency();
    return structuredClone(resolveDetail(id));
  },

  async createReview(prUrl) {
    await latency();
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl.trim());
    if (!match) {
      throw new ApiError(400, "that is not a GitHub pull request URL");
    }
    const repo = repos.find((item) => item.owner === match[1] && item.name === match[2]);
    if (!repo) {
      throw new ApiError(404, "repo not set up");
    }
    if (repo.cloneState !== "ready") {
      throw new ApiError(409, `repo clone is ${repo.cloneState}`);
    }
    const existing = [...createdReviews, ...seededReviews].find(
      (item) => item.repoId === repo.id && item.prNumber === Number(match[3]) && item.phase !== "failed",
    );
    if (existing) {
      return structuredClone(existing);
    }
    const id = nextId("rev");
    const detail = buildDetail(id, "preparing");
    detail.review.prUrl = prUrl;
    detail.review.prNumber = Number(match[3]);
    detail.review.repoId = repo.id;
    detail.repo = repo;
    details.set(id, detail);
    createdReviews.unshift({ ...detail.review, repoOwner: repo.owner, repoName: repo.name });
    simulatePreparation(detail);
    return structuredClone(detail.review);
  },

  async answerGap(reviewId, gapId, answer) {
    await latency();
    const detail = resolveDetail(reviewId);
    const found = detail.gaps.find((item) => item.id === gapId);
    if (!found) {
      throw new ApiError(404, "gap not found");
    }
    found.answer = answer;
    touch(detail);
    publish(reviewId, "gap.answered", { gap: found });
    return structuredClone(found);
  },

  async completeContext(reviewId, notes) {
    await latency();
    const detail = resolveDetail(reviewId);
    requirePhase(detail, "context");
    if (detail.gaps.some((item) => !item.answer)) {
      throw new ApiError(409, "every gap needs an answer first");
    }
    detail.review.reviewerNotes = notes ?? null;
    detail.review.phase = "checkpoint";
    touch(detail);
    publish(reviewId, "review.updated", { review: detail.review });
    void agentTurn(detail, [
      () => activity(detail, "Read", "app/jobs/invoice_export_job.rb"),
      () => activity(detail, "Grep", "BaseStreamingJob"),
      () => {
        activity(detail, "set_approach_summary", "with observation");
        detail.review.approachSummary = approachSummary;
        detail.review.approachParts = approachParts;
        touch(detail);
        publish(reviewId, "review.updated", { review: detail.review });
      },
      () => pushAgentMessage(detail, "Approach summary recorded. The observation about BaseStreamingJob is worth a look before we plan the steps."),
    ]);
    return structuredClone(detail.review);
  },

  async syncPullRequest(reviewId) {
    await latency();
    const detail = resolveDetail(reviewId);
    const { review } = detail;
    const paths = detail.steps.flatMap((step) => step.files.map((file) => file.path));
    if (paths.length === 0) return { review: structuredClone(review), changed: false };
    review.reviewedSha = review.reviewedSha ?? review.headSha;
    review.headSha = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
    review.updatedPaths = paths.filter((_, index) => index % 2 === 0);
    touch(detail);
    publish(reviewId, "review.updated", { review });
    return { review: structuredClone(review), changed: true };
  },

  async rerunStep(reviewId, step, notes) {
    await latency();
    const detail = resolveDetail(reviewId);
    const { review } = detail;
    const order = ["requirements", "intent", "approach", "code_review"] as const;
    const later = order.slice(order.indexOf(step) + 1).filter((key) =>
      key === "code_review" ? detail.steps.length > 0 : review.approachSummary !== null,
    );
    const stale = new Set([...review.staleSteps, ...later]);
    if (notes !== undefined) review.reviewerNotes = notes || review.reviewerNotes;
    if (step === "code_review") {
      review.phase = "planning";
      stale.add("code_review");
    } else {
      review.approachDecision = null;
      review.phase = step === "requirements" ? "context" : "checkpoint";
      if (step === "intent") stale.delete("intent");
      else stale.add(step);
      if (step === "intent") stale.add("approach");
    }
    review.staleSteps = [...stale];
    touch(detail);
    publish(reviewId, "review.updated", { review });
    void agentTurn(detail, [
      () => activity(detail, "get_review_state", "re-run"),
      () => {
        if (step === "requirements") {
          activity(detail, "set_intent_summary", "re-run");
          review.staleSteps = review.staleSteps.filter((key) => key !== "requirements");
        } else if (step === "code_review") {
          activity(detail, "set_step_plan", "re-run");
          detail.steps = buildSteps(reviewId);
          review.phase = "review";
          review.staleSteps = review.staleSteps.filter((key) => key !== "code_review");
          publish(reviewId, "steps.updated", { steps: detail.steps });
        } else {
          activity(detail, "set_approach_summary", "re-run");
          review.approachSummary = approachSummary;
          review.approachParts = approachParts;
          review.staleSteps = review.staleSteps.filter((key) => key !== "approach");
        }
        touch(detail);
        publish(reviewId, "review.updated", { review });
      },
      () => pushAgentMessage(detail, "Re-run finished."),
    ]).then(() => {
      if (step === "code_review") simulateUpfrontReview(detail);
    });
    return structuredClone(review);
  },

  async decideApproach(reviewId, input) {
    await latency();
    const detail = resolveDetail(reviewId);
    requirePhase(detail, "checkpoint");
    const { review } = detail;

    if (input.decision === "proceed") {
      review.approachDecision = "proceed";
      review.phase = "planning";
      touch(detail);
      publish(reviewId, "review.updated", { review });
      void agentTurn(detail, [
        () => activity(detail, "Bash", "git diff origin/main...HEAD --name-status"),
        () => {
          activity(detail, "set_step_plan", "2 steps, 8 files");
          detail.steps = buildSteps(reviewId);
          review.phase = "review";
          touch(detail);
          publish(reviewId, "steps.updated", { steps: detail.steps });
          publish(reviewId, "review.updated", { review });
        },
        () => pushAgentMessage(detail, "Step plan is in. Two steps, the job first because the endpoint is a thin wrapper around it."),
      ]).then(() => simulateUpfrontReview(detail));
    } else if (input.decision === "correct") {
      const note = input.note ?? "";
      const reviewerMsg = message(reviewId, "reviewer", `Correction: ${note}`, 0);
      reviewerMsg.createdAt = Date.now();
      detail.chat.push(reviewerMsg);
      publish(reviewId, "chat.message", { message: reviewerMsg });
      void agentTurn(detail, [
        () => activity(detail, "Grep", "ReconciliationJob"),
        () => {
          activity(detail, "set_approach_summary", "revised");
          review.approachSummary = `${approachSummary} Revised after your note: ${note}`;
          touch(detail);
          publish(reviewId, "review.updated", { review });
        },
        () => pushAgentMessage(detail, "Understood. I have revised the approach summary with that in mind."),
      ]);
    } else {
      review.approachDecision = "reject";
      review.phase = "review";
      touch(detail);
      publish(reviewId, "review.updated", { review });
      void agentTurn(detail, [
        () => {
          activity(detail, "propose_finding", "PR-level, blocking");
          const finding: Finding = {
            id: nextId("finding"),
            reviewId,
            path: null,
            line: null,
            endLine: null,
            origin: "ai",
            severity: "blocking",
            title: "Approach does not fit the repo's job framework",
            body: input.note?.trim() || "This change should extend BaseStreamingJob rather than re-implementing paging and progress. Happy to pair on the migration.",
            evidence: "Reviewer rejected the approach at checkpoint.",
            confidence: "high",
            status: "proposed",
            rejectReason: null,
            agentChallenge: null,
            verification: null,
            verifierNote: null,
            githubCommentId: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          detail.findings.push(finding);
          publish(reviewId, "finding.added", { finding });
        },
        () => pushAgentMessage(detail, "Drafted a PR-level comment that explains the rejection. Accept it when you are ready to post."),
      ]);
    }
    return structuredClone(review);
  },

  async sendChat(reviewId, text) {
    await latency();
    const detail = resolveDetail(reviewId);
    if (detail.agentBusy) {
      throw new ApiError(409, "agent is busy");
    }
    const msg: ChatMessage = { id: nextId("msg"), reviewId, role: "reviewer", content: text, createdAt: Date.now() };
    detail.chat.push(msg);
    touch(detail);
    publish(reviewId, "chat.message", { message: msg });
    void agentTurn(detail, [
      () => activity(detail, "get_review_state", "phase and open questions"),
      () => pushAgentMessage(detail, `On "${text.slice(0, 60)}": noted. In mock mode I can only acknowledge, but the real agent would answer from the worktree.`),
    ]);
    return { queued: true };
  },

  async answerQuestion(reviewId, questionId, answer) {
    await latency();
    const detail = resolveDetail(reviewId);
    const question = detail.questions.find((item) => item.id === questionId);
    if (!question) {
      throw new ApiError(404, "question not found");
    }
    question.answer = answer;
    touch(detail);
    publish(reviewId, "question.answered", { question });
    return structuredClone(question);
  },

  async patchStep(reviewId, stepId, patch) {
    await latency();
    const detail = resolveDetail(reviewId);
    const step = detail.steps.find((item) => item.id === stepId);
    if (!step) {
      throw new ApiError(404, "step not found");
    }
    Object.assign(step, patch);
    touch(detail);
    publish(reviewId, "steps.updated", { steps: detail.steps });
    const { files: _files, ...row } = step;
    return structuredClone(row);
  },

  async patchFile(reviewId, fileId, state) {
    await latency();
    const detail = resolveDetail(reviewId);
    const { step, file } = findFile(detail, fileId);
    file.state = state;
    if (state === "in_progress") {
      step.state = "in_progress";
    }
    if (step.files.filter((item) => !item.skipped).every((item) => item.state === "done")) {
      step.state = "done";
    }
    touch(detail);
    publish(reviewId, "file.updated", { file });
    publish(reviewId, "steps.updated", { steps: detail.steps });

    const reviewed = reviewedSet(detail);
    if (state === "in_progress" && !file.skipped && step.kind === "code" && file.checked === null && !detail.agentBusy && !reviewed.has(file.path)) {
      reviewed.add(file.path);
      simulateFileReview(detail, file);
    } else if (state === "done") {
      nudgeAfterDone(detail, file);
    }
    return structuredClone(file);
  },

  async fileDiff(reviewId, fileId) {
    await latency();
    const detail = resolveDetail(reviewId);
    const { file } = findFile(detail, fileId);
    const fixture = fixtureFor(file.path);
    return { path: file.path, status: fixture.status, patch: renderPatch(file.path, fixture) };
  },

  async fileContent(reviewId, fileId, side) {
    await latency();
    const detail = resolveDetail(reviewId);
    const { file } = findFile(detail, fileId);
    const fixture = fixtureFor(file.path);
    if ((side === "old" && fixture.status === "added") || (side === "new" && fixture.status === "deleted")) {
      throw new ApiError(404, `file does not exist on the ${side} side`);
    }
    return { path: file.path, content: renderContent(fixture, side) };
  },

  async addFinding(reviewId, input) {
    await latency();
    const detail = resolveDetail(reviewId);
    const finding: Finding = {
      id: nextId("finding"),
      reviewId,
      path: input.path,
      line: input.line ?? null,
      endLine: input.endLine ?? null,
      origin: "reviewer",
      severity: input.severity,
      title: input.title,
      body: input.body,
      evidence: null,
      confidence: null,
      status: "accepted",
      rejectReason: null,
      agentChallenge: null,
      verification: null,
      verifierNote: null,
      githubCommentId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    detail.findings.push(finding);
    touch(detail);
    publish(reviewId, "finding.added", { finding });
    if (!detail.agentBusy) {
      const where = `${input.path}${input.line ? `:${input.line}` : ""}`;
      void agentTurn(
        detail,
        [
          () => activity(detail, "Read", input.path),
          () => pushAgentMessage(detail, `Noted your ${input.severity.replaceAll("_", " ")} on ${where}. I will keep it in mind for the rest of the step.`),
        ],
        600,
      );
    }
    return structuredClone(finding);
  },

  async patchFinding(reviewId, findingId, patch) {
    await latency();
    const detail = resolveDetail(reviewId);
    const finding = detail.findings.find((item) => item.id === findingId);
    if (!finding) {
      throw new ApiError(404, "finding not found");
    }
    if (finding.status === "posted") {
      throw new ApiError(409, "finding is already posted");
    }
    if (patch.status === "rejected" && finding.origin === "ai" && !patch.rejectReason?.trim()) {
      throw new ApiError(400, "rejectReason is required when rejecting an AI finding");
    }
    Object.assign(finding, patch, { updatedAt: Date.now() });
    touch(detail);
    publish(reviewId, "finding.updated", { finding });
    return structuredClone(finding);
  },

  async postFindings(reviewId, input) {
    await latency();
    const detail = resolveDetail(reviewId);
    const accepted = detail.findings.filter((item) => item.status === "accepted");
    for (const finding of accepted) {
      finding.status = "posted";
    }
    const submitted = input.verdict !== "comment" || input.summary?.trim() ? input.verdict : null;
    detail.review.phase = "done";
    detail.review.postedAt = Date.now();
    if (submitted) detail.review.verdict = submitted;
    touch(detail);
    publish(reviewId, "review.updated", { review: detail.review });
    return { posted: accepted.length, failed: [], verdict: submitted };
  },

  async stats() {
    await latency();
    const perReview = [
      {
        id: "rev_done",
        title: "Fix rounding on partial refunds",
        prUrl: "https://github.com/acme/shop-api/pull/471",
        prNumber: 471,
        repoOwner: "acme",
        repoName: "shop-api",
        createdAt: minutesAgo(60 * 26),
        postedAt: minutesAgo(60 * 25),
        minutes: 58,
        aiFindings: 6,
        aiPosted: 3,
        aiRejected: 2,
        reviewerFindings: 2,
        posted: 5,
        highRiskFilesDone: 3,
        rubberStamped: 1,
        costUsd: 1.84,
      },
      {
        id: "rev_older",
        title: "Add VAT breakdown to invoice export",
        prUrl: "https://github.com/acme/shop-api/pull/463",
        prNumber: 463,
        repoOwner: "acme",
        repoName: "shop-api",
        createdAt: minutesAgo(60 * 50),
        postedAt: minutesAgo(60 * 49),
        minutes: 34,
        aiFindings: 4,
        aiPosted: 2,
        aiRejected: 1,
        reviewerFindings: 1,
        posted: 3,
        highRiskFilesDone: 2,
        rubberStamped: 0,
        costUsd: 0.92,
      },
      {
        id: "rev_oldest",
        title: "Retry failed payouts overnight",
        prUrl: "https://github.com/acme/shop-api/pull/455",
        prNumber: 455,
        repoOwner: "acme",
        repoName: "shop-api",
        createdAt: minutesAgo(60 * 80),
        postedAt: minutesAgo(60 * 78),
        minutes: 112,
        aiFindings: 9,
        aiPosted: 4,
        aiRejected: 4,
        reviewerFindings: 3,
        posted: 7,
        highRiskFilesDone: 4,
        rubberStamped: 1,
        costUsd: null,
      },
    ];
    return {
      reviews: perReview.length,
      caughtThatIMissed: 9,
      aiNoiseRate: 7 / 16,
      rubberStampRate: 2 / 9,
      minutesPerReview: 58,
      findingsBySeverity: { blocking: 3, should_fix: 9, nit: 10, question: 3 },
      costUsd: 2.76,
      perReview,
    };
  },

  async getMemory(repoId) {
    await latency();
    return { content: memoryFor(repoId) };
  },

  async putMemory(repoId, content) {
    await latency();
    const missing = memoryHeadings.filter((heading) => !content.split("\n").some((line) => line.trim() === heading));
    if (missing.length > 0) {
      throw new ApiError(400, `Memory must keep its section headings; missing: ${missing.join(", ")}`);
    }
    memoryStore.set(repoId, content.endsWith("\n") ? content : `${content}\n`);
    return { content: memoryFor(repoId) };
  },

  async listDocEdits(repoId) {
    await latency();
    return structuredClone(docEditStore.filter((edit) => edit.repoId === repoId).sort((a, b) => b.createdAt - a.createdAt));
  },

  async patchDocEdit(repoId, editId, status) {
    await latency();
    const edit = docEditStore.find((item) => item.id === editId && item.repoId === repoId);
    if (!edit) {
      throw new ApiError(404, "doc edit not found");
    }
    if (edit.status === "opened") {
      throw new ApiError(409, "this edit is already in a docs PR");
    }
    edit.status = status;
    edit.error = null;
    return structuredClone(edit);
  },

  async openDocsPr(repoId) {
    await latency();
    const approved = docEditStore.filter((edit) => edit.repoId === repoId && edit.status === "approved");
    if (approved.length === 0) {
      throw new ApiError(409, "No approved doc edits to open a PR for");
    }
    for (const edit of approved) {
      edit.status = "opened";
    }
    return { prUrl: "https://github.com/acme/shop-api/pull/999" };
  },

  async memoryDiff(reviewId) {
    await latency();
    const detail = resolveDetail(reviewId);
    if (detail.review.phase !== "posting" && detail.review.phase !== "done") {
      throw new ApiError(409, `review is in phase ${detail.review.phase}`);
    }
    return { before: memoryBefore, after: memoryFor(detail.review.repoId) };
  },
};
