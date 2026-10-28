import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { config } from "./config.js";
import type { Db } from "./db/client.js";
import { optionalImport } from "./lib/optional-import.js";
import { claudeAuthRoutes } from "./routes/claude-auth.js";
import { eventRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { integrationRoutes } from "./routes/integrations.js";
import { mcpStatusRoutes } from "./routes/mcp-status.js";
import { repoRoutes } from "./routes/repos.js";
import { reviewReadRoutes } from "./routes/reviews-read.js";
import type { RepoDeps } from "./services/repos.js";

export type BuildAppOptions = {
  db: Db;
  logger?: boolean;
  repoDeps?: RepoDeps;
};

type RoutePlugin = (app: FastifyInstance, opts: { db: Db }) => Promise<void>;

const optionalPlugins: Array<{ file: string; name: string }> = [
  { file: "./routes/internal.js", name: "internalRoutes" },
  { file: "./routes/reviews-write.js", name: "reviewWriteRoutes" },
  { file: "./routes/post.js", name: "postRoutes" },
  { file: "./routes/repo-knowledge.js", name: "repoKnowledgeRoutes" },
];

function statusOf(error: unknown): number {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const code = error.statusCode;
    if (typeof code === "number" && code >= 400 && code <= 599) return code;
  }
  return 500;
}

function datesAsEpochMs(this: Record<string, unknown>, key: string, value: unknown): unknown {
  const raw = this[key];
  return raw instanceof Date ? raw.getTime() : value;
}

export function serialiseJson(payload: unknown): string {
  return JSON.stringify(payload, datesAsEpochMs);
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { db, logger = false, repoDeps } = options;
  const app = Fastify({ logger });

  app.setReplySerializer(serialiseJson);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const message = error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
      return reply.code(400).send({ error: message, issues: error.issues });
    }
    const statusCode = statusOf(error);
    if (statusCode >= 500) request.log.error(error);
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(statusCode).send({ error: message });
  });

  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: `Route ${request.method} ${request.url} not found` }));

  await app.register(cors, { origin: config.webOrigin });
  await app.register(healthRoutes);
  await app.register(mcpStatusRoutes);
  await app.register(integrationRoutes);
  await app.register(claudeAuthRoutes);
  await app.register(repoRoutes, { db, ...(repoDeps ? { repoDeps } : {}) });
  await app.register(reviewReadRoutes, { db });
  await app.register(eventRoutes, { db });

  for (const { file, name } of optionalPlugins) {
    const mod = await optionalImport<Record<string, unknown>>(new URL(file, import.meta.url));
    const plugin = mod?.[name];
    if (typeof plugin !== "function") {
      app.log.info(`${file} not present, skipping ${name}`);
      continue;
    }
    await app.register(plugin as RoutePlugin, { db });
  }

  return app;
}
