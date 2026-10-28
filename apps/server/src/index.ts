import { buildApp } from "./app.js";
import { config, ensureDataDirs } from "./config.js";
import { openDb } from "./db/client.js";
import { optionalImport } from "./lib/optional-import.js";
import { bus } from "./events/bus.js";
import { verifier } from "./services/agent/verifier.js";
import { continueUpfrontReview } from "./services/review.js";

type McpConfigModule = { writeMcpTemplate?: () => void | Promise<void> };

ensureDataDirs();
const db = openDb(config.paths.db);
const app = await buildApp({ db, logger: true });

const mcpConfig = await optionalImport<McpConfigModule>(new URL("./services/agent/mcp-config.js", import.meta.url));
if (mcpConfig?.writeMcpTemplate) {
  await mcpConfig.writeMcpTemplate();
} else {
  app.log.info("mcp-config.js not present, skipping MCP template");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
bus.subscribeAll((reviewId, event) => {
  if (event.type !== "agent.turn_done") return;
  continueUpfrontReview(db, reviewId).catch((err: unknown) => app.log.error(err));
});
const resumed = verifier.resumePending(db);
if (resumed > 0) app.log.info(`Resumed verification of ${resumed} finding(s)`);
app.log.info(`Data directory: ${config.dataDir}`);
