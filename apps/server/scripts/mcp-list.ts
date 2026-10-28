import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { toolNames } from "../src/services/agent/tool-schemas.js";

type JsonRpcResponse = { id?: number; result?: { tools?: Array<{ name: string }> }; error?: { message: string } };

const mainPath = path.resolve(import.meta.dirname, "..", "src", "dashboard-mcp", "main.ts");

const child = spawn(process.execPath, ["--import", "tsx", mainPath], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, AI_REVIEW_API: "http://127.0.0.1:4100", AI_REVIEW_REVIEW_ID: "smoke-test" },
});

const pending = new Map<number, (response: JsonRpcResponse) => void>();
let nextId = 1;

readline.createInterface({ input: child.stdout }).on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line) as JsonRpcResponse;
  if (typeof message.id === "number") pending.get(message.id)?.(message);
});

function request(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function notify(method: string): void {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
}

function finish(code: number): never {
  child.stdin.end();
  child.kill();
  process.exit(code);
}

const timer = setTimeout(() => {
  console.error("timed out waiting for the MCP server");
  finish(1);
}, 15000);

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-list", version: "0.0.0" },
  });
  if (init.error) throw new Error(`initialize failed: ${init.error.message}`);
  notify("notifications/initialized");

  const listed = await request("tools/list", {});
  if (listed.error) throw new Error(`tools/list failed: ${listed.error.message}`);
  const names = (listed.result?.tools ?? []).map((tool) => tool.name);
  for (const name of names) console.log(name);

  clearTimeout(timer);
  const sameOrder = names.length === toolNames.length && names.every((name, index) => name === toolNames[index]);
  if (!sameOrder) {
    console.error(`expected ${toolNames.length} tools in order [${toolNames.join(", ")}], got ${names.length}`);
    finish(1);
  }
  finish(0);
} catch (err) {
  clearTimeout(timer);
  console.error(err instanceof Error ? err.message : String(err));
  finish(1);
}
