import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-review-memory-"));
process.env.AI_REVIEW_DATA_DIR = dataDir;

const memory = await import("./memory.js");

describe("memory", () => {
  before(async () => {
    await fs.mkdir(path.join(dataDir, "memory"), { recursive: true });
  });

  after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("memoryFilePath points at data/memory/<repoId>.md", () => {
    assert.equal(memory.memoryFilePath("repo-1"), path.join(dataDir, "memory", "repo-1.md"));
  });

  it("readMemory returns the four-section template when the file is missing", async () => {
    const content = await memory.readMemory("missing");
    const headings = content.split("\n").filter((line) => line.startsWith("## "));
    assert.deepEqual(headings, ["## Review preferences", "## Recurring patterns", "## Corrections to the agent", "## Author notes"]);
    assert.equal(content.endsWith("\n"), true);
  });

  it("writeMemory then readMemory round-trips", async () => {
    await memory.writeMemory("rt", "## Review preferences\n\n- short comments\n");
    assert.equal(await memory.readMemory("rt"), "## Review preferences\n\n- short comments\n");
  });

  it("appendMemoryEntries creates the file from the template and appends under the right section", async () => {
    const result = await memory.appendMemoryEntries("fresh", [
      { section: "recurring_patterns", text: "Missing await on repository calls" },
      { section: "author_notes", text: "Alice prefers small PRs" },
    ]);
    assert.deepEqual(result, { added: 2 });
    const content = await memory.readMemory("fresh");
    assert.equal(
      content,
      [
        "## Review preferences",
        "",
        "## Recurring patterns",
        "",
        "- Missing await on repository calls",
        "",
        "## Corrections to the agent",
        "",
        "## Author notes",
        "",
        "- Alice prefers small PRs",
        "",
      ].join("\n"),
    );
  });

  it("appendMemoryEntries skips exact duplicates and keeps existing lines", async () => {
    await memory.appendMemoryEntries("dupes", [{ section: "review_preferences", text: "No nits on tests" }]);
    const again = await memory.appendMemoryEntries("dupes", [
      { section: "review_preferences", text: "No nits on tests" },
      { section: "review_preferences", text: "No nits on tests" },
      { section: "review_preferences", text: "Flag raw Date maths" },
    ]);
    assert.deepEqual(again, { added: 1 });
    const content = await memory.readMemory("dupes");
    assert.equal(content.split("- No nits on tests").length - 1, 1);
    assert.match(content, /## Review preferences\n\n- No nits on tests\n- Flag raw Date maths\n\n## Recurring patterns/);
  });

  it("appendMemoryEntries preserves hand-written content and restores a missing section", async () => {
    await memory.writeMemory("hand", "Intro line kept by hand.\n\n## Review preferences\n\n- existing\n\n## Author notes\n");
    await memory.appendMemoryEntries("hand", [{ section: "agent_corrections", text: "Do not flag console.warn" }]);
    const content = await memory.readMemory("hand");
    assert.equal(content.startsWith("Intro line kept by hand.\n\n## Review preferences\n\n- existing\n"), true);
    assert.match(content, /## Corrections to the agent\n\n- Do not flag console\.warn\n$/);
  });
});
