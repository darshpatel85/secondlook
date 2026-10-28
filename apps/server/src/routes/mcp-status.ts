import type { FastifyInstance } from "fastify";
import { getMcpStatus } from "../services/mcp-status.js";

export async function mcpStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { refresh?: string } }>("/api/mcp-status", async (request) =>
    getMcpStatus(request.query.refresh === "1"),
  );
}
