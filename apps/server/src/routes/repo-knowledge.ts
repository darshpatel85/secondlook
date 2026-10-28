import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { HttpError } from "../lib/http-error.js";
import { listDocEdits, openDocsPr, setDocEditStatus } from "../services/doc-edits.js";
import { missingMemorySections, readMemory, snapshotMemoryBefore, writeMemory } from "../services/memory.js";
import { getRepo } from "../services/repos.js";
import { getReview } from "../services/review-read.js";

const memoryBody = z.object({ content: z.string() });
const docEditPatch = z.object({ status: z.enum(["approved", "discarded"]) });

export async function repoKnowledgeRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  app.get<{ Params: { id: string } }>("/api/repos/:id/memory", async (request) => {
    getRepo(db, request.params.id);
    return { content: await readMemory(request.params.id) };
  });

  app.put<{ Params: { id: string } }>("/api/repos/:id/memory", async (request) => {
    getRepo(db, request.params.id);
    const { content } = memoryBody.parse(request.body);
    const missing = missingMemorySections(content);
    if (missing.length > 0) throw new HttpError(400, `Memory must keep its section headings; missing: ${missing.join(", ")}`);
    await writeMemory(request.params.id, content.endsWith("\n") ? content : `${content}\n`);
    return { content: await readMemory(request.params.id) };
  });

  app.get<{ Params: { id: string } }>("/api/repos/:id/doc-edits", async (request) => listDocEdits(db, request.params.id));

  app.patch<{ Params: { id: string; editId: string } }>("/api/repos/:id/doc-edits/:editId", async (request) => {
    const { status } = docEditPatch.parse(request.body);
    return setDocEditStatus(db, request.params.id, request.params.editId, status);
  });

  app.post<{ Params: { id: string } }>("/api/repos/:id/docs-pr", async (request) => openDocsPr(db, request.params.id));

  app.get<{ Params: { id: string } }>("/api/reviews/:id/memory-diff", async (request) => {
    const review = getReview(db, request.params.id);
    if (review.phase !== "posting" && review.phase !== "done") {
      throw new HttpError(409, `Memory changes are only available once the review is posting or done, not ${review.phase}`);
    }
    const before = await snapshotMemoryBefore(review.repoId, review.id);
    return { before, after: await readMemory(review.repoId) };
  });
}
