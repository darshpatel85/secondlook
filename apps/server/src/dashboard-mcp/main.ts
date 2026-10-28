import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toolDescriptions, toolNames, toolShapes, type ToolName } from "../services/agent/tool-schemas.js";

const apiBase = (process.env.AI_REVIEW_API ?? "http://127.0.0.1:4100").replace(/\/$/, "");
const reviewId = process.env.AI_REVIEW_REVIEW_ID;

const log = (message: string): void => {
  process.stderr.write(`[dashboard-mcp] ${message}\n`);
};

const textResult = (text: string, isError = false): CallToolResult => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError: true } : {}),
});

async function callDashboard(name: ToolName, args: unknown): Promise<CallToolResult> {
  if (!reviewId) return textResult("AI_REVIEW_REVIEW_ID is not set for this MCP process", true);
  const url = `${apiBase}/internal/reviews/${encodeURIComponent(reviewId)}/tools/${name}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args ?? {}),
    });
    const body = await response.text();
    return textResult(body, !response.ok);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return textResult(`dashboard request failed: ${message}`, true);
  }
}

function registerDashboardTool(server: McpServer, name: ToolName): void {
  const inputSchema: ZodRawShapeCompat = toolShapes[name];
  server.registerTool(name, { description: toolDescriptions[name], inputSchema }, (args) => callDashboard(name, args));
}

async function main(): Promise<void> {
  if (!reviewId) log("AI_REVIEW_REVIEW_ID is not set; tool calls will fail");
  const server = new McpServer({ name: "dashboard", version: "0.1.0" });
  for (const name of toolNames) registerDashboardTool(server, name);

  const transport = new StdioServerTransport();
  process.stdin.on("end", () => {
    void server.close().finally(() => process.exit(0));
  });
  await server.connect(transport);
  log(`ready, forwarding to ${apiBase}`);
}

main().catch((err: unknown) => {
  log(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
