import { spawn } from "node:child_process";
import readline from "node:readline";
import { config } from "../config.js";
import { childEnv } from "./agent/process.js";
import { writeMcpTemplate } from "./agent/mcp-config.js";
import { loadIntegrations } from "../integrations.js";

export type McpServerStatus = { name: string; label: string; status: string };
export type McpStatus = { servers: McpServerStatus[]; checkedAt: number; error?: string };

const cacheTtlMs = 5 * 60 * 1000;
const probeTimeoutMs = 20_000;
let cached: McpStatus | undefined;
let inFlight: Promise<McpStatus> | undefined;

function parseInit(line: string, labels: Map<string, string>): McpServerStatus[] | undefined {
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const event = parsed as { type?: unknown; subtype?: unknown; mcp_servers?: unknown };
  if (event.type !== "system" || event.subtype !== "init" || !Array.isArray(event.mcp_servers)) return undefined;
  return event.mcp_servers.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const server = entry as { name?: unknown; status?: unknown };
    if (typeof server.name !== "string" || typeof server.status !== "string") return [];
    return [{ name: server.name, label: labels.get(server.name) ?? server.name, status: server.status }];
  });
}

function probe(): Promise<McpStatus> {
  const integrations = loadIntegrations();
  if (integrations.length === 0) return Promise.resolve({ servers: [], checkedAt: Date.now() });
  const labels = new Map(integrations.map((integration) => [integration.name, integration.label]));
  const templatePath = writeMcpTemplate();
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "haiku",
    "--mcp-config",
    templatePath,
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--tools",
    "",
  ];
  return new Promise((resolve) => {
    const child = spawn(config.claudeBin, args, { env: childEnv(), stdio: ["pipe", "pipe", "ignore"] });
    const finish = (result: McpStatus): void => {
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(result);
    };
    const timer = setTimeout(() => finish({ servers: [], checkedAt: Date.now(), error: "probe timed out" }), probeTimeoutMs);
    child.on("error", (error) => finish({ servers: [], checkedAt: Date.now(), error: error.message }));
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const servers = parseInit(line, labels);
        if (servers) finish({ servers, checkedAt: Date.now() });
      } catch {
        return;
      }
    });
    child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: "Reply ok" } })}\n`);
  });
}

export async function getMcpStatus(refresh = false): Promise<McpStatus> {
  if (!refresh && cached && Date.now() - cached.checkedAt < cacheTtlMs) return cached;
  if (!inFlight) {
    inFlight = probe().then((result) => {
      cached = result;
      inFlight = undefined;
      return result;
    });
  }
  return inFlight;
}

export function forgetMcpStatus(): void {
  cached = undefined;
}
