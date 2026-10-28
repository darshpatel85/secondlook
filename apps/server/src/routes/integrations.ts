import type { FastifyInstance } from "fastify";
import { readIntegrationSettings, writeIntegrationSettings, type IntegrationSettings } from "../integrations.js";
import { mcpTemplatePath, writeMcpTemplate } from "../services/agent/mcp-config.js";
import { forgetMcpStatus } from "../services/mcp-status.js";

function view(settings: IntegrationSettings) {
  return {
    settings,
    signInCommand: `claude --mcp-config ${mcpTemplatePath()} --strict-mcp-config`,
  };
}

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/integrations", async () => view(readIntegrationSettings()));

  app.put("/api/integrations", async (request) => {
    const settings = writeIntegrationSettings(request.body ?? {});
    writeMcpTemplate();
    forgetMcpStatus();
    return view(settings);
  });
}
