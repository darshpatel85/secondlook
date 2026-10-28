import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client.js";
import { handleTool, ToolError } from "../services/agent/tools.js";
import { verifier } from "../services/agent/verifier.js";
import { autoConfirmContext } from "../services/review.js";

type ToolParams = { reviewId: string; tool: string };

export async function internalRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  app.post<{ Params: ToolParams }>("/internal/reviews/:reviewId/tools/:tool", async (request, reply) => {
    const { reviewId, tool } = request.params;
    try {
      const result = await handleTool(opts.db, reviewId, tool, request.body);
      if (tool === "propose_finding") verifyNewFinding(opts.db, result);
      if (tool === "set_context_checklist") {
        await autoConfirmContext(opts.db, reviewId).catch((err: unknown) => request.log.error(err));
      }
      return reply.send(result);
    } catch (err) {
      if (err instanceof ToolError) return reply.status(err.status).send(err.payload);
      request.log.error(err);
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

function verifyNewFinding(db: Db, result: unknown): void {
  const findingId = (result as { findingId?: unknown } | null)?.findingId;
  if (typeof findingId === "string") verifier.enqueue(db, findingId);
}
