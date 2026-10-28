import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { config, ensureDataDirs } from "../../config.js";
import { openDb, type Db } from "../../db/client.js";
import { agentEvents, chatMessages, reviews, type Repo, type Review } from "../../db/schema.js";
import { bus } from "../../events/bus.js";
import { newId } from "../../lib/ids.js";
import type { AgentManager, AgentStreamEvent } from "./contracts.js";
import { mcpConfigPath, writeMcpConfig } from "./mcp-config.js";
import { AgentProcess, buildClaudeArgs, childEnv } from "./process.js";
import { eventTypeName, summariseAssistant, summariseResult } from "./stream.js";

export type AgentManagerDeps = { db?: Db };

let sharedDb: Db | undefined;

function openSharedDb(): Db {
  if (sharedDb === undefined) {
    ensureDataDirs();
    sharedDb = openDb(config.paths.db);
  }
  return sharedDb;
}

class ProcessAgentManager implements AgentManager {
  private readonly processes = new Map<string, AgentProcess>();
  private readonly injectedDb: Db | undefined;

  constructor(deps: AgentManagerDeps) {
    this.injectedDb = deps.db;
  }

  private get db(): Db {
    return this.injectedDb ?? openSharedDb();
  }

  async ensureStarted(review: Review, repo: Repo): Promise<void> {
    const reviewDir = path.join(config.paths.reviews, review.id);
    const systemPromptPath = path.join(reviewDir, "system-prompt.md");
    if (!fs.existsSync(systemPromptPath)) {
      throw new Error(`system prompt missing for review ${review.id}: ${systemPromptPath}`);
    }
    const mcpPath = mcpConfigPath(reviewDir);
    if (!fs.existsSync(mcpPath)) writeMcpConfig(reviewDir, review.id);

    if (this.processes.get(review.id)?.running) return;
    if (review.worktreePath === null) {
      throw new Error(`review ${review.id} has no worktree path`);
    }

    const reviewId = review.id;
    const agent = new AgentProcess({
      command: config.claudeBin,
      args: buildClaudeArgs({
        sessionId: review.sessionId,
        resume: review.sessionStarted,
        mcpConfigPath: mcpPath,
        systemPromptPath,
        worktreePath: review.worktreePath,
        relatedPaths: repo.relatedPaths,
      }),
      cwd: review.worktreePath,
      env: childEnv(),
      onEvent: (event) => this.handleEvent(reviewId, event),
      onUnparseable: (line) => bus.publish(reviewId, { type: "agent.error", message: line }),
      onStderr: (line) => this.storeEvent(reviewId, "stderr", { text: line }),
      onError: (error) => bus.publish(reviewId, { type: "agent.error", message: error.message }),
      onExit: (code) => {
        if (this.processes.get(reviewId) === agent) this.processes.delete(reviewId);
        bus.publish(reviewId, { type: "agent.exited", code });
      },
    });
    this.processes.set(reviewId, agent);
  }

  send(reviewId: string, text: string): void {
    const agent = this.processes.get(reviewId);
    if (agent === undefined || !agent.running) {
      throw new Error(`no agent process is running for review ${reviewId}`);
    }
    agent.send(text);
  }

  isBusy(reviewId: string): boolean {
    return this.processes.get(reviewId)?.busy ?? false;
  }

  isRunning(reviewId: string): boolean {
    return this.processes.get(reviewId)?.running ?? false;
  }

  async stop(reviewId: string): Promise<void> {
    const agent = this.processes.get(reviewId);
    if (agent === undefined) return;
    await agent.stop();
    if (this.processes.get(reviewId) === agent) this.processes.delete(reviewId);
  }

  private storeEvent(reviewId: string, type: string, payload: Record<string, unknown>): void {
    try {
      this.db.insert(agentEvents).values({ reviewId, type, payload }).run();
    } catch (error) {
      bus.publish(reviewId, { type: "agent.error", message: `failed to store ${type} event: ${describe(error)}` });
    }
  }

  private handleEvent(reviewId: string, event: AgentStreamEvent): void {
    this.storeEvent(reviewId, eventTypeName(event), event);
    try {
      switch (event.type) {
        case "system":
          if (event.subtype === "init") this.markSessionStarted(reviewId);
          break;
        case "assistant":
          this.handleAssistant(reviewId, event);
          break;
        case "result":
          this.handleResult(reviewId, event);
          break;
        default:
          break;
      }
    } catch (error) {
      bus.publish(reviewId, { type: "agent.error", message: `failed to handle ${event.type} event: ${describe(error)}` });
    }
  }

  private markSessionStarted(reviewId: string): void {
    this.db.update(reviews).set({ sessionStarted: true, updatedAt: new Date() }).where(eq(reviews.id, reviewId)).run();
  }

  private handleAssistant(reviewId: string, event: AgentStreamEvent): void {
    const { texts, tools } = summariseAssistant(event);
    for (const text of texts) {
      const message = this.db
        .insert(chatMessages)
        .values({ id: newId(), reviewId, role: "agent", content: text })
        .returning()
        .get();
      bus.publish(reviewId, { type: "chat.message", message });
    }
    for (const tool of tools) {
      bus.publish(reviewId, { type: "agent.activity", tool: tool.name, summary: tool.summary });
    }
  }

  private handleResult(reviewId: string, event: AgentStreamEvent): void {
    const result = summariseResult(event);
    bus.publish(reviewId, { type: "agent.turn_done", costUsd: result.costUsd, durationMs: result.durationMs });
    if (result.isError) bus.publish(reviewId, { type: "agent.error", message: result.text });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAgentManager(deps: AgentManagerDeps = {}): AgentManager {
  return new ProcessAgentManager(deps);
}

export const agentManager: AgentManager = createAgentManager();
