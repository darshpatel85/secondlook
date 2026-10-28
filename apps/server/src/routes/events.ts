import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { bus } from "../events/bus.js";
import { getReview } from "../services/review-read.js";

const pingIntervalMs = 15_000;

const debugPublishInput = z.object({
  type: z.string().min(1),
  data: z.record(z.unknown()).default({}),
});

export async function eventRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  app.get<{ Params: { id: string } }>("/api/reviews/:id/events", async (request, reply) => {
    const review = getReview(db, request.params.id);

    const allowOrigin = reply.getHeader("access-control-allow-origin");
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      ...(typeof allowOrigin === "string" ? { "access-control-allow-origin": allowOrigin } : {}),
    });
    reply.hijack();
    reply.raw.write(": connected\n\n");

    const unsubscribe = bus.subscribe(review.id, (event) => {
      const { type, ...data } = event;
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), pingIntervalMs);

    request.raw.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  if (process.env.NODE_ENV !== "production") {
    app.post<{ Params: { reviewId: string } }>("/api/debug/publish/:reviewId", async (request) => {
      const { type, data } = debugPublishInput.parse(request.body);
      bus.publish(request.params.reviewId, { type, ...data });
      return { ok: true };
    });
  }
}
