import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = (): Date => new Date();

export const repos = sqliteTable("repos", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  cloneUrl: text("clone_url").notNull(),
  defaultBranch: text("default_branch").notNull(),
  kind: text("kind", { enum: ["backend", "frontend", "other"] }).notNull(),
  skillPath: text("skill_path").notNull(),
  docsPaths: text("docs_paths", { mode: "json" }).$type<string[]>().notNull(),
  relatedPaths: text("related_paths", { mode: "json" }).$type<string[]>().notNull().default([]),
  clonePath: text("clone_path").notNull(),
  cloneState: text("clone_state", { enum: ["pending", "ready", "failed"] }).notNull(),
  cloneError: text("clone_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const observationVerdicts = ["fits", "concern"] as const;
export type ObservationVerdict = (typeof observationVerdicts)[number];

export type ApproachObservation = { verdict: ObservationVerdict; title: string; points: string[]; checkInReview?: boolean };

export type ApproachPart = { title: string; points: string[]; observations: ApproachObservation[] };

export const checklistStatuses = ["known", "unknown", "not_applicable"] as const;
export type ChecklistStatus = (typeof checklistStatuses)[number];
export const coverageStatuses = ["covered", "missing", "unclear"] as const;
export type CoverageStatus = (typeof coverageStatuses)[number];
export const checklistAreas = ["consumers", "data", "legacy"] as const;
export type ChecklistAreaKey = (typeof checklistAreas)[number];

export type ChecklistArea = { status: ChecklistStatus; summary: string; evidence: string[]; question?: string };
export type AcceptanceItem = { criterion: string; status: CoverageStatus; coveredBy?: string; question?: string };
export type ContextChecklist = Record<ChecklistAreaKey, ChecklistArea> & { acceptance: AcceptanceItem[] };

export const reviewSteps = ["requirements", "intent", "approach", "code_review"] as const;
export type ReviewStepKey = (typeof reviewSteps)[number];

export const reviewVerdicts = ["comment", "approve", "request_changes"] as const;
export type ReviewVerdict = (typeof reviewVerdicts)[number];

export const reviewPhases = ["preparing", "context", "checkpoint", "planning", "review", "posting", "done", "failed"] as const;
export type ReviewPhase = (typeof reviewPhases)[number];

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  repoId: text("repo_id").notNull().references(() => repos.id),
  prNumber: integer("pr_number").notNull(),
  prUrl: text("pr_url").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  author: text("author"),
  headRef: text("head_ref").notNull(),
  baseRef: text("base_ref").notNull(),
  headSha: text("head_sha").notNull(),
  reviewedSha: text("reviewed_sha"),
  updatedPaths: text("updated_paths", { mode: "json" }).$type<string[]>(),
  phase: text("phase", { enum: reviewPhases }).notNull(),
  phaseError: text("phase_error"),
  sessionId: text("session_id").notNull(),
  sessionStarted: integer("session_started", { mode: "boolean" }).notNull().default(false),
  worktreePath: text("worktree_path"),
  jiraKey: text("jira_key"),
  figmaUrl: text("figma_url"),
  intentSummary: text("intent_summary"),
  approachSummary: text("approach_summary"),
  approachObservation: text("approach_observation"),
  approachParts: text("approach_parts", { mode: "json" }).$type<ApproachPart[]>(),
  approachDecision: text("approach_decision", { enum: ["proceed", "reject"] }),
  contextChecklist: text("context_checklist", { mode: "json" }).$type<ContextChecklist>(),
  contextAutoConfirmed: integer("context_auto_confirmed", { mode: "boolean" }).notNull().default(false),
  reviewerNotes: text("reviewer_notes"),
  staleSteps: text("stale_steps", { mode: "json" }).$type<ReviewStepKey[]>().notNull().default([]),
  setupWarnings: text("setup_warnings", { mode: "json" }).$type<string[]>().notNull().default([]),
  postedAt: integer("posted_at", { mode: "timestamp_ms" }),
  verdict: text("verdict", { enum: reviewVerdicts }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const memorySections = ["review_preferences", "recurring_patterns", "agent_corrections", "author_notes"] as const;
export type MemorySection = (typeof memorySections)[number];

export const contextGaps = sqliteTable("context_gaps", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").notNull().references(() => reviews.id),
  question: text("question").notNull(),
  answer: text("answer"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const riskLevels = ["low", "medium", "high"] as const;
export const progressStates = ["not_started", "in_progress", "done"] as const;
export const stepKinds = ["code", "design"] as const;
export const reviewModes = ["as_you_go", "look_first"] as const;
export const stepRoutings = ["auto", "findings", "full"] as const;
export type StepRouting = (typeof stepRoutings)[number];

export const steps = sqliteTable("steps", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").notNull().references(() => reviews.id),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  purpose: text("purpose").notNull(),
  risk: text("risk", { enum: riskLevels }).notNull(),
  kind: text("kind", { enum: stepKinds }).notNull().default("code"),
  reviewMode: text("review_mode", { enum: reviewModes }).notNull().default("as_you_go"),
  routing: text("routing", { enum: stepRoutings }).notNull().default("full"),
  riskReason: text("risk_reason"),
  state: text("state", { enum: progressStates }).notNull().default("not_started"),
});

export const stepFiles = sqliteTable("step_files", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").notNull().references(() => reviews.id),
  stepId: text("step_id").notNull().references(() => steps.id),
  position: integer("position").notNull(),
  path: text("path").notNull(),
  skipped: integer("skipped", { mode: "boolean" }).notNull().default(false),
  skipReason: text("skip_reason"),
  state: text("state", { enum: progressStates }).notNull().default("not_started"),
  checked: text("checked", { mode: "json" }).$type<string[]>(),
});

export const findingOrigins = ["ai", "reviewer", "chat"] as const;
export const severities = ["blocking", "should_fix", "nit", "question"] as const;
export const confidences = ["low", "medium", "high"] as const;
export const findingStatuses = ["proposed", "accepted", "rejected", "parked", "posted"] as const;
export const verificationStates = ["pending", "confirmed", "refuted", "failed"] as const;
export type VerificationState = (typeof verificationStates)[number];

export const findings = sqliteTable("findings", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").notNull().references(() => reviews.id),
  path: text("path"),
  line: integer("line"),
  endLine: integer("end_line"),
  origin: text("origin", { enum: findingOrigins }).notNull(),
  severity: text("severity", { enum: severities }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  evidence: text("evidence"),
  confidence: text("confidence", { enum: confidences }),
  status: text("status", { enum: findingStatuses }).notNull().default("proposed"),
  rejectReason: text("reject_reason"),
  agentChallenge: text("agent_challenge"),
  verification: text("verification", { enum: verificationStates }),
  verifierNote: text("verifier_note"),
  githubCommentId: integer("github_comment_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").notNull().references(() => reviews.id),
  role: text("role", { enum: ["reviewer", "agent", "system"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const agentQuestions = sqliteTable("agent_questions", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").notNull().references(() => reviews.id),
  path: text("path"),
  question: text("question").notNull(),
  answer: text("answer"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const agentEvents = sqliteTable("agent_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reviewId: text("review_id").notNull().references(() => reviews.id),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const docEditStatuses = ["proposed", "approved", "discarded", "opened"] as const;
export type DocEditStatus = (typeof docEditStatuses)[number];

export const docEdits = sqliteTable("doc_edits", {
  id: text("id").primaryKey(),
  repoId: text("repo_id").notNull().references(() => repos.id),
  reviewId: text("review_id").references(() => reviews.id),
  path: text("path").notNull(),
  diff: text("diff").notNull(),
  rationale: text("rationale").notNull(),
  status: text("status", { enum: docEditStatuses }).notNull().default("proposed"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export type Repo = typeof repos.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type ContextGap = typeof contextGaps.$inferSelect;
export type Step = typeof steps.$inferSelect;
export type StepFile = typeof stepFiles.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type AgentQuestion = typeof agentQuestions.$inferSelect;
export type DocEdit = typeof docEdits.$inferSelect;
