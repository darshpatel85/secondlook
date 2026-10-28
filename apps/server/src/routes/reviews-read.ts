import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client.js";
import { getReviewDetail, listReviews } from "../services/review-read.js";

export async function reviewReadRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  app.get("/api/reviews", async () => listReviews(db));

  app.get<{ Params: { id: string } }>("/api/reviews/:id", async (request) => getReviewDetail(db, request.params.id));
}
