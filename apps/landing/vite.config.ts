import fs from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vite";

const envFile = new URL("../../.env", import.meta.url);
const rootEnv: Record<string, string | undefined> = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};

export default defineConfig({
  server: {
    port: Number(rootEnv.LANDING_PORT || 5175),
    strictPort: true,
  },
});
