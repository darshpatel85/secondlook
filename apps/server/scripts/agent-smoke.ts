import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../src/config.js";
import { AgentProcess, buildClaudeArgs, childEnv } from "../src/services/agent/process.js";
import { eventTypeName, summariseResult } from "../src/services/agent/stream.js";

const TIMEOUT_MS = 120_000;
const authPattern = /not logged in|log ?in|authenticat|unauthori[sz]ed|invalid api key|oauth|401|token has expired|credentials/i;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-smoke-"));
const reviewDir = path.join(root, "review");
const workDir = path.join(root, "work");
fs.mkdirSync(reviewDir, { recursive: true });
fs.mkdirSync(workDir, { recursive: true });

const systemPromptPath = path.join(reviewDir, "system-prompt.md");
const mcpConfigPath = path.join(reviewDir, "mcp.json");
fs.writeFileSync(systemPromptPath, "You are a smoke test. Reply as briefly as possible.\n");
fs.writeFileSync(mcpConfigPath, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);

const sessionId = randomUUID();
const args = buildClaudeArgs({ sessionId, resume: false, mcpConfigPath, systemPromptPath, worktreePath: workDir });

console.log(`temp dir: ${root}`);
console.log(`session:  ${sessionId}`);
console.log(`command:  ${config.claudeBin} ${args.join(" ")}`);

let finished = false;

function cleanup(): void {
  fs.rmSync(root, { recursive: true, force: true });
}

function finish(code: number, message: string): void {
  if (finished) return;
  finished = true;
  console.log(message);
  const done = (): void => {
    cleanup();
    process.exit(code);
  };
  agent.stop().then(done, done);
}

const timer = setTimeout(() => finish(1, `No result event within ${TIMEOUT_MS / 1000}s; giving up.`), TIMEOUT_MS);

const agent = new AgentProcess({
  command: config.claudeBin,
  args,
  cwd: workDir,
  env: childEnv(),
  onEvent: (event) => {
    console.log(`[event] ${eventTypeName(event)} ${JSON.stringify(event).slice(0, 300)}`);
    if (event.type !== "result") return;
    clearTimeout(timer);
    const result = summariseResult(event);
    if (!result.isError) {
      finish(0, `Smoke OK: result "${result.text}" (cost ${result.costUsd ?? "?"} USD, ${result.durationMs ?? "?"} ms)`);
    } else if (authPattern.test(result.text)) {
      finish(2, `Authentication error from claude: ${result.text}\nRun \`claude login\` in a terminal, then try again.`);
    } else {
      finish(1, `Error result from claude: ${result.text}`);
    }
  },
  onUnparseable: (line) => console.log(`[unparseable] ${line}`),
  onStderr: (line) => console.error(`[stderr] ${line}`),
  onError: (error) => console.error(`[error] ${error.message}`),
  onExit: (code) => {
    clearTimeout(timer);
    if (finished) return;
    finished = true;
    cleanup();
    console.log(`claude exited with code ${code} before sending a result event.`);
    process.exit(code === 0 ? 1 : (code ?? 1));
  },
});

agent.send("Reply with the word ok");
