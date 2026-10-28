import { ApiError } from "./errors";
import { mockApi, subscribeMockEvents } from "./mock";
import {
  reviewEventTypes,
  type AgentQuestion,
  type ApproachInput,
  type ClaudeAuthStatus,
  type ClaudeLoginState,
  type ContextGap,
  type CreateRepoInput,
  type DocEdit,
  type DocEditStatus,
  type DocsPrResult,
  type FileContent,
  type FileDiff,
  type Finding,
  type FindingInput,
  type FindingPatch,
  type Health,
  type IntegrationSettings,
  type IntegrationsView,
  type McpStatus,
  type MemoryContent,
  type MemoryDiffResult,
  type OpenPull,
  type PostInput,
  type PostResult,
  type ProgressState,
  type Repo,
  type RepoPulls,
  type Review,
  type ReviewDetail,
  type ReviewEvent,
  type ReviewEventData,
  type ReviewEventType,
  type ReviewListItem,
  type ReviewStepKey,
  type Stats,
  type Step,
  type StepFile,
  type StepPatch,
  type SyncResult,
} from "./types";

export const isMock = import.meta.env.VITE_MOCK === "1";

export const queryKeys = {
  repos: ["repos"] as const,
  mcpStatus: ["mcp-status"] as const,
  integrations: ["integrations"] as const,
  claudeAuth: ["claude-auth"] as const,
  reviews: ["reviews"] as const,
  review: (id: string) => ["review", id] as const,
  stats: ["stats"] as const,
  repo: (id: string) => ["repo", id] as const,
  pulls: ["pulls"] as const,
  repoPulls: (repoId: string) => ["pulls", repoId] as const,
  memory: (repoId: string) => ["memory", repoId] as const,
  memoryDiff: (reviewId: string) => ["memory-diff", reviewId] as const,
  docEdits: (repoId: string) => ["doc-edits", repoId] as const,
};

export type Api = {
  health(): Promise<Health>;
  mcpStatus(refresh?: boolean): Promise<McpStatus>;
  integrations(): Promise<IntegrationsView>;
  saveIntegrations(settings: IntegrationSettings): Promise<IntegrationsView>;
  claudeAuth(): Promise<ClaudeAuthStatus>;
  startClaudeLogin(): Promise<{ login: ClaudeLoginState }>;
  listRepos(): Promise<Repo[]>;
  createRepo(input: CreateRepoInput): Promise<Repo>;
  getRepo(id: string): Promise<Repo>;
  updateRepoRelatedPaths(id: string, relatedPaths: string[]): Promise<Repo>;
  listRepoPulls(repoId: string): Promise<OpenPull[]>;
  listAllPulls(): Promise<RepoPulls[]>;
  listReviews(): Promise<ReviewListItem[]>;
  getReview(id: string): Promise<ReviewDetail>;
  createReview(prUrl: string): Promise<Review>;
  answerGap(reviewId: string, gapId: string, answer: string): Promise<ContextGap>;
  completeContext(reviewId: string, notes?: string): Promise<Review>;
  decideApproach(reviewId: string, input: ApproachInput): Promise<Review>;
  rerunStep(reviewId: string, step: ReviewStepKey, notes?: string): Promise<Review>;
  syncPullRequest(reviewId: string): Promise<SyncResult>;
  sendChat(reviewId: string, text: string): Promise<{ queued: true }>;
  answerQuestion(reviewId: string, questionId: string, answer: string): Promise<AgentQuestion>;
  patchStep(reviewId: string, stepId: string, patch: StepPatch): Promise<Step>;
  patchFile(reviewId: string, fileId: string, state: ProgressState): Promise<StepFile>;
  fileDiff(reviewId: string, fileId: string, sinceReview?: boolean): Promise<FileDiff>;
  fileContent(reviewId: string, fileId: string, side: "new" | "old"): Promise<FileContent>;
  addFinding(reviewId: string, input: FindingInput): Promise<Finding>;
  patchFinding(reviewId: string, findingId: string, patch: FindingPatch): Promise<Finding>;
  postFindings(reviewId: string, input: PostInput): Promise<PostResult>;
  stats(): Promise<Stats>;
  getMemory(repoId: string): Promise<MemoryContent>;
  putMemory(repoId: string, content: string): Promise<MemoryContent>;
  listDocEdits(repoId: string): Promise<DocEdit[]>;
  patchDocEdit(repoId: string, editId: string, status: DocEditStatus): Promise<DocEdit>;
  openDocsPr(repoId: string): Promise<DocsPrResult>;
  memoryDiff(reviewId: string): Promise<MemoryDiffResult>;
};

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT";
  body?: unknown;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(path, { method, headers, body });
  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `${method} ${path} failed with ${response.status}`;
    throw new ApiError(response.status, message);
  }

  return payload as T;
}

const encode = encodeURIComponent;

const httpApi: Api = {
  health: () => request("/api/health"),
  mcpStatus: (refresh = false) => request(`/api/mcp-status${refresh ? "?refresh=1" : ""}`),
  integrations: () => request("/api/integrations"),
  saveIntegrations: (settings) => request("/api/integrations", { method: "PUT", body: settings }),
  claudeAuth: () => request("/api/claude-auth"),
  startClaudeLogin: () => request("/api/claude-auth/login", { method: "POST" }),
  listRepos: () => request("/api/repos"),
  createRepo: (input) => request("/api/repos", { method: "POST", body: input }),
  getRepo: (id) => request(`/api/repos/${encode(id)}`),
  updateRepoRelatedPaths: (id, relatedPaths) => request(`/api/repos/${encode(id)}`, { method: "PATCH", body: { relatedPaths } }),
  listRepoPulls: (repoId) => request(`/api/repos/${encode(repoId)}/pulls`),
  listAllPulls: () => request("/api/pulls"),
  listReviews: () => request("/api/reviews"),
  getReview: (id) => request(`/api/reviews/${encode(id)}`),
  createReview: (prUrl) => request("/api/reviews", { method: "POST", body: { prUrl } }),
  answerGap: (reviewId, gapId, answer) =>
    request(`/api/reviews/${encode(reviewId)}/gaps/${encode(gapId)}`, { method: "POST", body: { answer } }),
  completeContext: (reviewId, notes) =>
    request(`/api/reviews/${encode(reviewId)}/context-complete`, {
      method: "POST",
      body: notes === undefined ? {} : { notes },
    }),
  decideApproach: (reviewId, input) =>
    request(`/api/reviews/${encode(reviewId)}/approach`, { method: "POST", body: input }),
  rerunStep: (reviewId, step, notes) =>
    request(`/api/reviews/${encode(reviewId)}/rerun`, { method: "POST", body: notes === undefined ? { step } : { step, notes } }),
  syncPullRequest: (reviewId) => request(`/api/reviews/${encode(reviewId)}/sync`, { method: "POST", body: {} }),
  sendChat: (reviewId, text) => request(`/api/reviews/${encode(reviewId)}/chat`, { method: "POST", body: { text } }),
  answerQuestion: (reviewId, questionId, answer) =>
    request(`/api/reviews/${encode(reviewId)}/questions/${encode(questionId)}`, { method: "POST", body: { answer } }),
  patchStep: (reviewId, stepId, patch) =>
    request(`/api/reviews/${encode(reviewId)}/steps/${encode(stepId)}`, { method: "PATCH", body: patch }),
  patchFile: (reviewId, fileId, state) =>
    request(`/api/reviews/${encode(reviewId)}/files/${encode(fileId)}`, { method: "PATCH", body: { state } }),
  fileDiff: (reviewId, fileId, sinceReview) =>
    request(`/api/reviews/${encode(reviewId)}/files/${encode(fileId)}/diff${sinceReview ? "?since=review" : ""}`),
  fileContent: (reviewId, fileId, side) =>
    request(`/api/reviews/${encode(reviewId)}/files/${encode(fileId)}/content?side=${side}`),
  addFinding: (reviewId, input) =>
    request(`/api/reviews/${encode(reviewId)}/findings`, { method: "POST", body: input }),
  patchFinding: (reviewId, findingId, patch) =>
    request(`/api/reviews/${encode(reviewId)}/findings/${encode(findingId)}`, { method: "PATCH", body: patch }),
  postFindings: (reviewId, input) => request(`/api/reviews/${encode(reviewId)}/post`, { method: "POST", body: input }),
  stats: () => request("/api/stats"),
  getMemory: (repoId) => request(`/api/repos/${encode(repoId)}/memory`),
  putMemory: (repoId, content) =>
    request(`/api/repos/${encode(repoId)}/memory`, { method: "PUT", body: { content } }),
  listDocEdits: (repoId) => request(`/api/repos/${encode(repoId)}/doc-edits`),
  patchDocEdit: (repoId, editId, status) =>
    request(`/api/repos/${encode(repoId)}/doc-edits/${encode(editId)}`, { method: "PATCH", body: { status } }),
  openDocsPr: (repoId) => request(`/api/repos/${encode(repoId)}/docs-pr`, { method: "POST" }),
  memoryDiff: (reviewId) => request(`/api/reviews/${encode(reviewId)}/memory-diff`),
};

export const api: Api = isMock ? mockApi : httpApi;

export type ReviewEventHandler = (event: ReviewEvent) => void;
export type ConnectionStatus = "connecting" | "open" | "reconnecting";
export type StatusHandler = (status: ConnectionStatus) => void;

export function toReviewEvent<K extends ReviewEventType>(type: K, data: ReviewEventData[K]): ReviewEvent {
  return { type, data } as ReviewEvent;
}

function subscribeHttpEvents(reviewId: string, onEvent: ReviewEventHandler, onStatus: StatusHandler): () => void {
  const source = new EventSource(`/api/reviews/${encode(reviewId)}/events`);
  onStatus("connecting");
  source.onopen = () => onStatus("open");
  source.onerror = () => onStatus("reconnecting");

  for (const type of reviewEventTypes) {
    source.addEventListener(type, (raw: MessageEvent<string>) => {
      try {
        const data: unknown = JSON.parse(raw.data);
        onEvent(toReviewEvent(type, data as ReviewEventData[typeof type]));
      } catch {
        return;
      }
    });
  }

  return () => source.close();
}

export function subscribeReviewEvents(
  reviewId: string,
  onEvent: ReviewEventHandler,
  onStatus: StatusHandler,
): () => void {
  if (isMock) {
    return subscribeMockEvents(reviewId, onEvent, onStatus);
  }
  return subscribeHttpEvents(reviewId, onEvent, onStatus);
}
