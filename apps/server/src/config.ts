import fs from "node:fs";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const envFile = path.join(workspaceRoot, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const dataDir = process.env.AI_REVIEW_DATA_DIR || path.join(workspaceRoot, "data");
const port = Number(process.env.PORT ?? 4100);

export const config = {
  port,
  host: process.env.HOST ?? "127.0.0.1",
  apiBaseUrl: `http://127.0.0.1:${port}`,
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  claudeBin: process.env.CLAUDE_BIN ?? "claude",
  agentModel: process.env.AI_REVIEW_MODEL ?? "opus",
  verifierModel: process.env.AI_REVIEW_VERIFIER_MODEL ?? process.env.AI_REVIEW_MODEL ?? "opus",
  githubToken: process.env.GITHUB_TOKEN || undefined,
  workspaceRoot,
  serverRoot: path.resolve(import.meta.dirname, ".."),
  dataDir,
  paths: {
    db: path.join(dataDir, "ai-review.sqlite"),
    repos: path.join(dataDir, "repos"),
    worktrees: path.join(dataDir, "worktrees"),
    reviews: path.join(dataDir, "reviews"),
    memory: path.join(dataDir, "memory"),
  },
  integrationsFile: process.env.AI_REVIEW_INTEGRATIONS || path.join(dataDir, "integrations.json"),
};

export function ensureDataDirs(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  for (const dir of [config.paths.repos, config.paths.worktrees, config.paths.reviews, config.paths.memory]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
