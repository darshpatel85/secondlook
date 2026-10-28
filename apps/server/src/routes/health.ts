import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

function readVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(config.serverRoot, "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") {
      return parsed.version;
    }
  } catch {
    return "0.0.0";
  }
  return "0.0.0";
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const version = readVersion();
  app.get("/api/health", async () => ({ ok: true, version }));
}
