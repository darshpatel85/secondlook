import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import { loadIntegrations, type McpServer } from "../../integrations.js";

type McpConfig = { mcpServers: Record<string, McpServer> };

const moduleRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const isDev = import.meta.url.endsWith(".ts");

export function dashboardCommand(): { command: string; args: string[] } {
  if (!isDev) {
    return { command: process.execPath, args: [path.join(moduleRoot, "dist", "dashboard-mcp", "main.js")] };
  }
  const main = path.join(moduleRoot, "src", "dashboard-mcp", "main.ts");
  const tsxCli = path.join(moduleRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const tsxBin = path.join(moduleRoot, "node_modules", ".bin", "tsx");
  return { command: process.execPath, args: [fs.existsSync(tsxCli) ? tsxCli : tsxBin, main] };
}

function integrationServers(): Record<string, McpServer> {
  return Object.fromEntries(loadIntegrations().map((integration) => [integration.name, integration.server]));
}

function writeJson(file: string, value: McpConfig): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

export function mcpConfigPath(reviewDir: string): string {
  return path.join(reviewDir, "mcp.json");
}

export function writeMcpConfig(reviewDir: string, reviewId: string): string {
  const dashboard = dashboardCommand();
  return writeJson(mcpConfigPath(reviewDir), {
    mcpServers: {
      dashboard: {
        type: "stdio",
        command: dashboard.command,
        args: dashboard.args,
        env: { AI_REVIEW_API: config.apiBaseUrl, AI_REVIEW_REVIEW_ID: reviewId },
      },
      ...integrationServers(),
    },
  });
}

export function mcpTemplatePath(): string {
  return path.join(config.dataDir, "mcp-template.json");
}

export function writeMcpTemplate(): string {
  return writeJson(mcpTemplatePath(), { mcpServers: integrationServers() });
}
