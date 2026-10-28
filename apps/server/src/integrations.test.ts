import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { hasIntegration, loadIntegrations, readIntegrationSettings, writeIntegrationSettings } from "./integrations.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-integrations-"));

function writeFile(name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

describe("loadIntegrations", () => {
  it("returns nothing when the file is missing", () => {
    assert.deepEqual(loadIntegrations(path.join(dir, "missing.json")), []);
  });

  it("turns jira and figma into the atlassian and figma servers with default urls", () => {
    const list = loadIntegrations(writeFile("presets.json", { jira: {}, figma: {} }));
    assert.deepEqual(
      list.map((integration) => [integration.name, integration.label, integration.server]),
      [
        ["atlassian", "Jira", { type: "http", url: "https://mcp.atlassian.com/v2/mcp" }],
        ["figma", "Figma", { type: "http", url: "https://mcp.figma.com/mcp" }],
      ],
    );
    assert.equal(hasIntegration(list, "atlassian"), true);
    assert.equal(hasIntegration(list, "linear"), false);
  });

  it("reads custom servers with their label and guidance", () => {
    const list = loadIntegrations(
      writeFile("custom.json", {
        servers: {
          "legacy-kb": { type: "stdio", command: "npx", args: ["tsx", "kb.ts"], label: "Legacy KB", guidance: "Check the old code." },
          docs: { type: "http", url: "https://example.com/mcp" },
        },
      }),
    );
    assert.deepEqual(list, [
      { name: "legacy-kb", label: "Legacy KB", server: { type: "stdio", command: "npx", args: ["tsx", "kb.ts"], env: {} }, guidance: "Check the old code." },
      { name: "docs", label: "docs", server: { type: "http", url: "https://example.com/mcp" }, guidance: null },
    ]);
  });

  it("rejects reserved names and unknown keys with the file path in the error", () => {
    const reserved = writeFile("reserved.json", { servers: { figma: { type: "http", url: "https://example.com" } } });
    assert.throws(() => loadIntegrations(reserved), /reserved\.json is not valid: servers\.figma: "figma" is a reserved name/);
    assert.throws(() => loadIntegrations(writeFile("typo.json", { jiraa: {} })), /typo\.json is not valid/);
  });
});

describe("writeIntegrationSettings", () => {
  it("fills in defaults, writes the file and reads back the same settings", () => {
    const file = path.join(dir, "written.json");
    const saved = writeIntegrationSettings({ jira: { siteUrl: "https://acme.atlassian.net" } }, file);
    assert.deepEqual(saved, { jira: { url: "https://mcp.atlassian.com/v2/mcp", siteUrl: "https://acme.atlassian.net" }, servers: {} });
    assert.deepEqual(readIntegrationSettings(file), saved);
  });

  it("refuses invalid settings and leaves the file alone", () => {
    const file = path.join(dir, "kept.json");
    writeIntegrationSettings({ figma: {} }, file);
    assert.throws(() => writeIntegrationSettings({ servers: { "Bad Name": { type: "http", url: "https://x.dev" } } }, file));
    assert.deepEqual(Object.keys(readIntegrationSettings(file)), ["figma", "servers"]);
  });
});
