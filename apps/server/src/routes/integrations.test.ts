import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-integrations-route-"));
process.env.AI_REVIEW_DATA_DIR = dataDir;
process.env.AI_REVIEW_INTEGRATIONS = path.join(dataDir, "integrations.json");

const Fastify = (await import("fastify")).default;
const { integrationRoutes } = await import("./integrations.js");

async function makeApp() {
  const app = Fastify();
  await app.register(integrationRoutes);
  return app;
}

describe("integration routes", () => {
  it("starts with nothing connected and a sign-in command", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/integrations" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.settings, { servers: {} });
    assert.match(body.signInCommand, /^claude --mcp-config .*mcp-template\.json --strict-mcp-config$/);
  });

  it("saves settings and writes them into the sign-in template", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "PUT",
      url: "/api/integrations",
      payload: { figma: {}, servers: { docs: { type: "http", url: "https://docs.example.com/mcp", label: "Docs" } } },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(res.json().settings.servers), ["docs"]);
    const template = JSON.parse(fs.readFileSync(path.join(dataDir, "mcp-template.json"), "utf8"));
    assert.deepEqual(Object.keys(template.mcpServers), ["figma", "docs"]);
    const again = await app.inject({ method: "GET", url: "/api/integrations" });
    assert.equal(again.json().settings.figma.url, "https://mcp.figma.com/mcp");
  });
});
