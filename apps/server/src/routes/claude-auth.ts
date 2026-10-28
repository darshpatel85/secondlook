import type { FastifyInstance } from "fastify";
import { getClaudeAuthStatus, startClaudeLogin } from "../services/claude-auth.js";

export async function claudeAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/claude-auth", async () => getClaudeAuthStatus());
  app.post("/api/claude-auth/login", async () => ({ login: startClaudeLogin() }));
}
