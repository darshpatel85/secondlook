import fs from "node:fs";
import { parseEnv } from "node:util";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const envFile = new URL("../../.env", import.meta.url);
const rootEnv: Record<string, string | undefined> = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(rootEnv.WEB_PORT || 5173),
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${rootEnv.PORT || 4100}`,
        changeOrigin: true,
      },
    },
  },
});
