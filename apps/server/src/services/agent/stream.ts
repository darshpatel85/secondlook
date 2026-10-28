import type { AgentStreamEvent } from "./contracts.js";

export type ToolActivity = { name: string; summary: string };
export type AssistantSummary = { texts: string[]; tools: ToolActivity[] };
export type ResultSummary = { costUsd?: number; durationMs?: number; isError: boolean; text: string };

const SUMMARY_LENGTH = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLine(line: string): AgentStreamEvent | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
  return parsed as AgentStreamEvent;
}

export function eventTypeName(event: AgentStreamEvent): string {
  return typeof event.subtype === "string" && event.subtype !== "" ? `${event.type}.${event.subtype}` : event.type;
}

function contentBlocks(event: AgentStreamEvent): Record<string, unknown>[] {
  if (!isRecord(event.message) || !Array.isArray(event.message.content)) return [];
  return event.message.content.filter(isRecord);
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

export function describeToolCall(name: string, rawInput: unknown): string {
  const input = typeof rawInput === "object" && rawInput !== null ? (rawInput as Record<string, unknown>) : {};
  const fallback = JSON.stringify(input).slice(0, SUMMARY_LENGTH);
  if (name === "Read") return `read ${str(input, "file_path") ?? fallback}`;
  if (name === "Grep") return `searched for "${str(input, "pattern") ?? ""}"${str(input, "path") ? ` in ${str(input, "path")}` : ""}`;
  if (name === "Glob") return `listed files matching ${str(input, "pattern") ?? fallback}`;
  if (name === "Bash") return `ran ${str(input, "command") ?? fallback}`;
  if (name === "ToolSearch") return "looked up tools";
  const mcp = /^mcp__([^_]+)__(.+)$/.exec(name);
  if (mcp) {
    const [, server, tool] = mcp;
    if (server === "dashboard") return `recorded ${tool?.replace(/_/g, " ")}`;
    if (server === "atlassian") return `${tool} ${str(input, "issueIdOrKey") ?? str(input, "jql") ?? str(input, "pageId") ?? ""}`.trim();
    if (server === "figma") return `${tool} ${str(input, "fileKey") ?? str(input, "nodeId") ?? ""}`.trim();
    return `${server}: ${tool}`;
  }
  return `${name} ${fallback}`;
}

export function summariseAssistant(event: AgentStreamEvent): AssistantSummary {
  const texts: string[] = [];
  const tools: ToolActivity[] = [];
  for (const block of contentBlocks(event)) {
    if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      texts.push(block.text);
    } else if (block.type === "tool_use" && typeof block.name === "string") {
      tools.push({ name: block.name, summary: describeToolCall(block.name, block.input) });
    }
  }
  return { texts, tools };
}

export function summariseResult(event: AgentStreamEvent): ResultSummary {
  const summary: ResultSummary = {
    isError: event.is_error === true,
    text: typeof event.result === "string" ? event.result : JSON.stringify(event.result ?? null),
  };
  if (typeof event.total_cost_usd === "number") summary.costUsd = event.total_cost_usd;
  if (typeof event.duration_ms === "number") summary.durationMs = event.duration_ms;
  return summary;
}
