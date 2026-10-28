import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { memorySections, type MemorySection } from "../db/schema.js";

export type MemoryEntry = { section: MemorySection; text: string };

export const memorySectionTitles: Record<MemorySection, string> = {
  review_preferences: "Review preferences",
  recurring_patterns: "Recurring patterns",
  agent_corrections: "Corrections to the agent",
  author_notes: "Author notes",
};

type ParsedMemory = { preamble: string[]; sections: Array<{ title: string; lines: string[] }> };

export function memoryFilePath(repoId: string): string {
  return path.join(config.paths.memory, `${repoId}.md`);
}

export function memoryTemplate(): string {
  return serialise({ preamble: [], sections: memorySections.map((s) => ({ title: memorySectionTitles[s], lines: [] })) });
}

export async function readMemory(repoId: string): Promise<string> {
  try {
    return await fs.readFile(memoryFilePath(repoId), "utf8");
  } catch (err) {
    if (isNotFound(err)) return memoryTemplate();
    throw err;
  }
}

export async function writeMemory(repoId: string, content: string): Promise<void> {
  await fs.mkdir(config.paths.memory, { recursive: true });
  await fs.writeFile(memoryFilePath(repoId), content, "utf8");
}

export function memoryBeforePath(reviewId: string): string {
  return path.join(config.paths.reviews, reviewId, "memory-before.md");
}

export async function snapshotMemoryBefore(repoId: string, reviewId: string): Promise<string> {
  const file = memoryBeforePath(reviewId);
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  const content = await readMemory(repoId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
  return content;
}

export function missingMemorySections(content: string): string[] {
  const headings = new Set(
    content
      .split("\n")
      .map((line) => /^##\s+(.+?)\s*$/.exec(line)?.[1])
      .filter((title): title is string => title !== undefined),
  );
  return memorySections.map((s) => memorySectionTitles[s]).filter((title) => !headings.has(title));
}

export async function appendMemoryEntries(repoId: string, entries: MemoryEntry[]): Promise<{ added: number }> {
  const parsed = parse(await readMemory(repoId));
  let added = 0;
  for (const entry of entries) {
    const section = findOrCreateSection(parsed, memorySectionTitles[entry.section]);
    const bullet = `- ${entry.text.trim()}`;
    if (section.lines.some((line) => line.trim() === bullet)) continue;
    section.lines.push(bullet);
    added += 1;
  }
  if (added > 0) await writeMemory(repoId, serialise(parsed));
  return { added };
}

function parse(content: string): ParsedMemory {
  const parsed: ParsedMemory = { preamble: [], sections: [] };
  let current: { title: string; lines: string[] } | null = null;
  for (const line of content.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading?.[1] !== undefined) {
      current = { title: heading[1], lines: [] };
      parsed.sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      parsed.preamble.push(line);
    }
  }
  for (const section of parsed.sections) section.lines = trimBlankEdges(section.lines);
  parsed.preamble = trimBlankEdges(parsed.preamble);
  return parsed;
}

function serialise(parsed: ParsedMemory): string {
  const blocks: string[] = [];
  if (parsed.preamble.length > 0) blocks.push(parsed.preamble.join("\n"));
  for (const section of parsed.sections) {
    blocks.push(section.lines.length > 0 ? `## ${section.title}\n\n${section.lines.join("\n")}` : `## ${section.title}`);
  }
  return `${blocks.join("\n\n")}\n`;
}

function findOrCreateSection(parsed: ParsedMemory, title: string): { title: string; lines: string[] } {
  const existing = parsed.sections.find((s) => s.title === title);
  if (existing) return existing;
  const created = { title, lines: [] };
  parsed.sections.push(created);
  return created;
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start += 1;
  while (end > start && lines[end - 1]?.trim() === "") end -= 1;
  return lines.slice(start, end);
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}
