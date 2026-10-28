import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { findingStatuses, progressStates, reviewModes, reviewSteps, severities, stepRoutings } from "../db/schema.js";
import {
  addReviewerFinding,
  answerGap,
  answerQuestion,
  completeContext,
  createReview,
  decideApproach,
  defaultReviewDeps,
  fileContent,
  fileDiff,
  rerunStep,
  sendChat,
  setFileState,
  setStepOptions,
  syncPullRequest,
  updateFinding,
  type ReviewDeps,
} from "../services/review.js";

export type ReviewWriteRouteOptions = { db: Db; reviewDeps?: ReviewDeps };

const createReviewInput = z.object({ prUrl: z.string().trim().min(1) });
const answerInput = z.object({ answer: z.string().trim().min(1) });
const contextCompleteInput = z.object({ notes: z.string().optional() });
const approachInput = z.object({ decision: z.enum(["proceed", "reject", "correct"]), note: z.string().optional() });
const rerunInput = z.object({ step: z.enum(reviewSteps), notes: z.string().optional() });
const chatInput = z.object({ text: z.string().trim().min(1) });
const stepPatchInput = z.object({ reviewMode: z.enum(reviewModes).optional(), state: z.enum(progressStates).optional(), routing: z.enum(stepRoutings).optional() });
const filePatchInput = z.object({ state: z.enum(progressStates) });
const diffQuery = z.object({ since: z.enum(["review"]).optional() });
const sideQuery = z.object({ side: z.enum(["new", "old"]).default("new") });
const reviewerFindingInput = z.object({
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  severity: z.enum(severities),
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
});
const findingPatchInput = z.object({
  status: z.enum(findingStatuses).optional(),
  severity: z.enum(severities).optional(),
  body: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  evidence: z.string().trim().nullable().optional(),
  rejectReason: z.string().optional(),
});

type IdParams = { id: string };
type GapParams = IdParams & { gapId: string };
type QuestionParams = IdParams & { qid: string };
type StepParams = IdParams & { stepId: string };
type FileParams = IdParams & { fileId: string };
type FindingParams = IdParams & { fid: string };

export async function reviewWriteRoutes(app: FastifyInstance, opts: ReviewWriteRouteOptions): Promise<void> {
  const { db } = opts;
  const deps = opts.reviewDeps ?? defaultReviewDeps;

  app.post("/api/reviews", async (request, reply) => {
    const { prUrl } = createReviewInput.parse(request.body);
    const review = await createReview(db, prUrl, deps);
    return reply.code(201).send(review);
  });

  app.post<{ Params: IdParams }>("/api/reviews/:id/rerun", async (request) => {
    const { step, notes } = rerunInput.parse(request.body);
    return rerunStep(db, request.params.id, step, notes, deps);
  });

  app.post<{ Params: IdParams }>("/api/reviews/:id/sync", async (request) => syncPullRequest(db, request.params.id, deps));

  app.post<{ Params: GapParams }>("/api/reviews/:id/gaps/:gapId", async (request) => {
    const { answer } = answerInput.parse(request.body);
    return answerGap(db, request.params.id, request.params.gapId, answer);
  });

  app.post<{ Params: IdParams }>("/api/reviews/:id/context-complete", async (request) => {
    const { notes } = contextCompleteInput.parse(request.body ?? {});
    return completeContext(db, request.params.id, notes, deps);
  });

  app.post<{ Params: IdParams }>("/api/reviews/:id/approach", async (request) => {
    const input = approachInput.parse(request.body);
    return decideApproach(db, request.params.id, input, deps);
  });

  app.post<{ Params: IdParams }>("/api/reviews/:id/chat", async (request, reply) => {
    const { text } = chatInput.parse(request.body);
    await sendChat(db, request.params.id, text, deps);
    return reply.code(202).send({ queued: true });
  });

  app.post<{ Params: QuestionParams }>("/api/reviews/:id/questions/:qid", async (request) => {
    const { answer } = answerInput.parse(request.body);
    return answerQuestion(db, request.params.id, request.params.qid, answer, deps);
  });

  app.patch<{ Params: StepParams }>("/api/reviews/:id/steps/:stepId", async (request) => {
    const patch = stepPatchInput.parse(request.body);
    return setStepOptions(db, request.params.id, request.params.stepId, patch);
  });

  app.patch<{ Params: FileParams }>("/api/reviews/:id/files/:fileId", async (request) => {
    const { state } = filePatchInput.parse(request.body);
    return setFileState(db, request.params.id, request.params.fileId, state, deps);
  });

  app.get<{ Params: FileParams; Querystring: Record<string, unknown> }>("/api/reviews/:id/files/:fileId/diff", async (request) => {
    const { since } = diffQuery.parse(request.query ?? {});
    return fileDiff(db, request.params.id, request.params.fileId, deps, since === "review");
  });

  app.get<{ Params: FileParams; Querystring: Record<string, unknown> }>("/api/reviews/:id/files/:fileId/content", async (request) => {
    const { side } = sideQuery.parse(request.query);
    return fileContent(db, request.params.id, request.params.fileId, side, deps);
  });

  app.post<{ Params: IdParams }>("/api/reviews/:id/findings", async (request, reply) => {
    const input = reviewerFindingInput.parse(request.body);
    const finding = await addReviewerFinding(db, request.params.id, input, deps);
    return reply.code(201).send(finding);
  });

  app.patch<{ Params: FindingParams }>("/api/reviews/:id/findings/:fid", async (request) => {
    const patch = findingPatchInput.parse(request.body);
    return updateFinding(db, request.params.id, request.params.fid, patch);
  });
}
