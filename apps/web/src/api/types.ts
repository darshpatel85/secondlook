export const repoKinds = ["backend", "frontend", "other"] as const;
export type RepoKind = (typeof repoKinds)[number];

export type CloneState = "pending" | "ready" | "failed";

export type Repo = {
  id: string;
  owner: string;
  name: string;
  cloneUrl: string;
  defaultBranch: string;
  kind?: RepoKind;
  skillPath: string;
  docsPaths: string[];
  relatedPaths: string[];
  clonePath: string;
  cloneState: CloneState;
  cloneError: string | null;
  createdAt: number;
};

export const reviewStepKeys = ["requirements", "intent", "approach", "code_review"] as const;
export type ReviewStepKey = (typeof reviewStepKeys)[number];

export const reviewPhases = ["preparing", "context", "checkpoint", "planning", "review", "posting", "done", "failed"] as const;
export type ReviewPhase = (typeof reviewPhases)[number];

export type ObservationVerdict = "fits" | "concern";

export type ApproachObservation = { verdict: ObservationVerdict; title: string; points: string[]; checkInReview?: boolean };

export type ApproachPart = { title: string; points: string[]; observations: ApproachObservation[] };

export type ApproachDecision = "proceed" | "reject";

export type Review = {
  id: string;
  repoId: string;
  prNumber: number;
  prUrl: string;
  title: string;
  body: string | null;
  author: string | null;
  headRef: string;
  baseRef: string;
  headSha: string;
  reviewedSha: string | null;
  updatedPaths: string[] | null;
  phase: ReviewPhase;
  phaseError: string | null;
  sessionId: string;
  sessionStarted: boolean;
  worktreePath: string | null;
  jiraKey: string | null;
  figmaUrl: string | null;
  intentSummary: string | null;
  approachSummary: string | null;
  approachObservation: string | null;
  approachParts: ApproachPart[] | null;
  approachDecision: ApproachDecision | null;
  contextChecklist: ContextChecklist | null;
  contextAutoConfirmed: boolean;
  reviewerNotes: string | null;
  staleSteps: ReviewStepKey[];
  setupWarnings: string[];
  postedAt: number | null;
  verdict: ReviewVerdict | null;
  createdAt: number;
  updatedAt: number;
};

export type ReviewListItem = Review & { repoOwner: string; repoName: string };

export type PullApproval = "approved" | "changes_requested" | null;

export type OpenPull = {
  number: number;
  title: string;
  url: string;
  author: string | null;
  draft: boolean;
  headRef: string;
  baseRef: string;
  updatedAt: number;
  approval: PullApproval;
  review: { id: string; phase: ReviewPhase } | null;
};

export type RepoPulls = { repoId: string; owner: string; name: string; pulls: OpenPull[]; error: string | null };

export type ContextGap = {
  id: string;
  reviewId: string;
  question: string;
  answer: string | null;
  createdAt: number;
};

export type RiskLevel = "low" | "medium" | "high";
export type ProgressState = "not_started" | "in_progress" | "done";
export type StepKind = "code" | "design";
export type ReviewMode = "as_you_go" | "look_first";
export type StepRouting = "auto" | "findings" | "full";

export type ChecklistStatus = "known" | "unknown" | "not_applicable";
export type ChecklistArea = { status: ChecklistStatus; summary: string; evidence: string[]; question?: string };
export type AcceptanceItem = { criterion: string; status: "covered" | "missing" | "unclear"; coveredBy?: string; question?: string };
export type ContextChecklist = { consumers: ChecklistArea; data: ChecklistArea; legacy: ChecklistArea; acceptance: AcceptanceItem[] };

export type Step = {
  id: string;
  reviewId: string;
  position: number;
  title: string;
  purpose: string;
  risk: RiskLevel;
  kind: StepKind;
  reviewMode: ReviewMode;
  routing: StepRouting;
  riskReason: string | null;
  state: ProgressState;
};

export type StepFile = {
  id: string;
  reviewId: string;
  stepId: string;
  position: number;
  path: string;
  skipped: boolean;
  skipReason: string | null;
  state: ProgressState;
  checked: string[] | null;
};

export type StepWithFiles = Step & { files: StepFile[] };

export type FindingOrigin = "ai" | "reviewer" | "chat";
export const severities = ["blocking", "should_fix", "nit", "question"] as const;
export type Severity = (typeof severities)[number];
export type Confidence = "low" | "medium" | "high";
export type FindingStatus = "proposed" | "accepted" | "rejected" | "parked" | "posted";
export type VerificationState = "pending" | "confirmed" | "refuted" | "failed";

export type Finding = {
  id: string;
  reviewId: string;
  path: string | null;
  line: number | null;
  endLine: number | null;
  origin: FindingOrigin;
  severity: Severity;
  title: string;
  body: string;
  evidence: string | null;
  confidence: Confidence | null;
  status: FindingStatus;
  rejectReason: string | null;
  agentChallenge: string | null;
  verification: VerificationState | null;
  verifierNote: string | null;
  githubCommentId: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ChatRole = "reviewer" | "agent" | "system";

export type ChatMessage = {
  id: string;
  reviewId: string;
  role: ChatRole;
  content: string;
  createdAt: number;
};

export type AgentQuestion = {
  id: string;
  reviewId: string;
  path: string | null;
  question: string;
  answer: string | null;
  createdAt: number;
};

export type DocEditStatus = "proposed" | "approved" | "discarded" | "opened";

export type DocEdit = {
  id: string;
  repoId: string;
  reviewId: string | null;
  path: string;
  diff: string;
  rationale: string;
  status: DocEditStatus;
  error: string | null;
  createdAt: number;
};

export type SyncResult = { review: Review; changed: boolean };

export type ReviewDetail = {
  review: Review;
  repo: Repo;
  gaps: ContextGap[];
  steps: StepWithFiles[];
  findings: Finding[];
  questions: AgentQuestion[];
  chat: ChatMessage[];
  activity: ActivityItem[];
  agentBusy: boolean;
};

export type ActivityItem = { id: string; at: number; tool: string; text: string };

export type Health = { ok: boolean; version: string };

export type McpServerStatus = { name: string; label: string; status: string };
export type McpStatus = { servers: McpServerStatus[]; checkedAt: number; error?: string };

type ServerExtras = { label?: string; guidance?: string };
export type CustomServer =
  | ({ type: "stdio"; command: string; args: string[]; env: Record<string, string> } & ServerExtras)
  | ({ type: "http" | "sse"; url: string } & ServerExtras);
export type IntegrationSettings = {
  jira?: { url?: string; siteUrl?: string };
  figma?: { url?: string };
  servers: Record<string, CustomServer>;
};
export type IntegrationsView = { settings: IntegrationSettings; signInCommand: string };

export type ClaudeLoginState = { running: boolean; url: string | null; error: string | null; startedAt: number | null };
export type ClaudeAuthStatus = { loggedIn: boolean; authMethod: string | null; error?: string; login: ClaudeLoginState };

export type CreateRepoInput = {
  cloneUrl: string;
  kind?: RepoKind;
  skillPath: string;
  docsPaths?: string[];
  defaultBranch?: string;
  relatedPaths?: string[];
};

export type ApproachInput = { decision: "proceed" | "reject" | "correct"; note?: string };

export type StepPatch = { reviewMode?: ReviewMode; state?: ProgressState; routing?: StepRouting };

export type FindingInput = {
  path: string;
  line?: number;
  endLine?: number;
  severity: Severity;
  title: string;
  body: string;
};

export type FindingPatch = {
  status?: FindingStatus;
  severity?: Severity;
  body?: string;
  title?: string;
  evidence?: string | null;
  rejectReason?: string;
};

export type FileDiff = { path: string; status: string; patch: string };
export type FileContent = { path: string; content: string };
export const reviewVerdicts = ["comment", "approve", "request_changes"] as const;
export type ReviewVerdict = (typeof reviewVerdicts)[number];
export type PostInput = { verdict: ReviewVerdict; summary?: string };
export type PostResult = { posted: number; failed: Finding[]; verdict: ReviewVerdict | null };
export type ReviewStatsRow = {
  id: string;
  title: string;
  prUrl: string;
  prNumber: number;
  repoOwner: string;
  repoName: string;
  createdAt: number;
  postedAt: number;
  minutes: number;
  aiFindings: number;
  aiPosted: number;
  aiRejected: number;
  reviewerFindings: number;
  posted: number;
  highRiskFilesDone: number;
  rubberStamped: number;
  costUsd: number | null;
};

export type Stats = {
  reviews: number;
  caughtThatIMissed: number;
  aiNoiseRate: number | null;
  rubberStampRate: number | null;
  minutesPerReview: number | null;
  findingsBySeverity: Record<Severity, number>;
  costUsd: number;
  perReview: ReviewStatsRow[];
};
export type MemoryContent = { content: string };
export type MemoryDiffResult = { before: string; after: string };
export type DocsPrResult = { prUrl: string };

export const reviewEventTypes = [
  "review.updated",
  "gap.added",
  "gap.answered",
  "steps.updated",
  "file.updated",
  "finding.added",
  "finding.updated",
  "question.added",
  "question.answered",
  "chat.message",
  "agent.activity",
  "agent.turn_done",
  "agent.error",
  "agent.exited",
  "doc_edit.added",
] as const;

export type ReviewEventType = (typeof reviewEventTypes)[number];

export type ReviewEventData = {
  "review.updated": { review: Review };
  "gap.added": { gap: ContextGap };
  "gap.answered": { gap: ContextGap };
  "steps.updated": { steps: StepWithFiles[] };
  "file.updated": { file: StepFile };
  "finding.added": { finding: Finding };
  "finding.updated": { finding: Finding };
  "question.added": { question: AgentQuestion };
  "question.answered": { question: AgentQuestion };
  "chat.message": { message: ChatMessage };
  "agent.activity": { tool: string; summary: string };
  "agent.turn_done": { costUsd?: number; durationMs?: number };
  "agent.error": { message: string };
  "agent.exited": { code: number | null };
  "doc_edit.added": { docEdit: DocEdit };
};

export type ReviewEvent = {
  [K in ReviewEventType]: { type: K; data: ReviewEventData[K] };
}[ReviewEventType];
