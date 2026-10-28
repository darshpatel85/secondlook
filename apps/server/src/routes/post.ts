import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { reviewVerdicts } from "../db/schema.js";
import { defaultPostDeps, postReview, type PostDeps } from "../services/post.js";
import { computeStats } from "../services/stats.js";

const postInput = z.object({ verdict: z.enum(reviewVerdicts).optional(), summary: z.string().optional() });

export type PostRouteOptions = { db: Db; postDeps?: PostDeps };

export async function postRoutes(app: FastifyInstance, opts: PostRouteOptions): Promise<void> {
  const { db } = opts;
  const deps = opts.postDeps ?? defaultPostDeps;

  app.post<{ Params: { id: string } }>("/api/reviews/:id/post", async (request) =>
    postReview(db, request.params.id, postInput.parse(request.body ?? {}), deps),
  );

  app.get("/api/stats", async () => computeStats(db));
}
