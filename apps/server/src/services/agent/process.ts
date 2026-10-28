import { config } from "../../config.js";
import { loadIntegrations } from "../../integrations.js";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { AgentStreamEvent } from "./contracts.js";
import { parseLine } from "./stream.js";

const STOP_GRACE_MS = 5000;

const baseAllowedTools = [
  "Read",
  "Grep",
  "Glob",
  "ToolSearch",
  "Bash(git log:*)",
  "Bash(git blame:*)",
  "Bash(git show:*)",
  "Bash(git diff:*)",
  "mcp__dashboard",
];

function allowedTools(): string[] {
  return [...baseAllowedTools, ...loadIntegrations().map((integration) => `mcp__${integration.name}`)];
}

const disallowedTools = ["Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Agent"];

export type ClaudeArgsInput = {
  sessionId: string;
  resume: boolean;
  mcpConfigPath: string;
  systemPromptPath: string;
  worktreePath: string;
  relatedPaths?: string[];
};

export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    config.agentModel,
    input.resume ? "--resume" : "--session-id",
    input.sessionId,
    "--mcp-config",
    input.mcpConfigPath,
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--append-system-prompt-file",
    input.systemPromptPath,
    "--allowedTools",
    ...allowedTools(),
    "--disallowedTools",
    ...disallowedTools,
    "--permission-prompts",
    "none",
    "--add-dir",
    input.worktreePath,
    ...(input.relatedPaths ?? []),
  ];
}

export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

export type AgentProcessOptions = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  onEvent(event: AgentStreamEvent): void;
  onUnparseable(line: string): void;
  onStderr(line: string): void;
  onError(error: Error): void;
  onExit(code: number | null): void;
};

export class AgentProcess {
  private readonly child: ChildProcessByStdio<Writable, Readable, Readable>;
  private readonly queue: string[] = [];
  private turnInFlight = false;
  private exited = false;
  private exitCode: number | null = null;
  private readonly exitPromise: Promise<void>;

  constructor(private readonly options: AgentProcessOptions) {
    this.child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdin.on("error", (error: Error) => options.onError(error));

    readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on("line", (line) => this.handleLine(line));
    readline.createInterface({ input: this.child.stderr, crlfDelay: Infinity }).on("line", (line) => {
      if (line.trim() !== "") options.onStderr(line);
    });

    this.exitPromise = new Promise<void>((resolve) => {
      const finish = (code: number | null): void => {
        if (this.exited) return;
        this.exited = true;
        this.exitCode = code;
        this.queue.length = 0;
        this.turnInFlight = false;
        options.onExit(code);
        resolve();
      };
      this.child.on("error", (error: Error) => {
        options.onError(error);
        if (this.child.pid === undefined) finish(null);
      });
      this.child.on("close", (code) => finish(code));
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get running(): boolean {
    return !this.exited;
  }

  get busy(): boolean {
    return this.turnInFlight;
  }

  get code(): number | null {
    return this.exitCode;
  }

  send(text: string): void {
    if (this.exited) throw new Error("agent process has exited");
    const line = JSON.stringify({ type: "user", message: { role: "user", content: text } });
    if (this.turnInFlight) {
      this.queue.push(line);
      return;
    }
    this.writeLine(line);
  }

  async stop(): Promise<void> {
    if (this.exited) return;
    this.child.stdin.end();
    const timer = setTimeout(() => {
      if (!this.exited) this.child.kill("SIGKILL");
    }, STOP_GRACE_MS);
    await this.exitPromise;
    clearTimeout(timer);
  }

  private writeLine(line: string): void {
    this.turnInFlight = true;
    this.child.stdin.write(`${line}\n`);
  }

  private handleLine(line: string): void {
    const event = parseLine(line);
    if (event === null) {
      if (line.trim() !== "") this.options.onUnparseable(line);
      return;
    }
    if (event.type === "result") this.turnInFlight = false;
    this.options.onEvent(event);
    if (event.type === "result" && !this.exited) {
      const next = this.queue.shift();
      if (next !== undefined) this.writeLine(next);
    }
  }
}
