import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSessionMiddleware,
  resolveSessionDir,
} from "./server/sessionApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionDir = resolveSessionDir();
const repoRoot = path.resolve(__dirname, "../..");
const trustedExtra = (process.env.IUI_TRUSTED_DIRS ?? "")
  .split(/[:;]/)
  .map((s) => s.trim())
  .filter(Boolean);
const fsAllow = [
  repoRoot,
  path.join(os.homedir(), ".intelligent-ui-mcp", "trusted"),
  ...trustedExtra,
];

export default defineConfig({
  plugins: [
    react(),
    {
      name: "iui-session-api",
      configureServer(server) {
        // Register early so /api/* never falls through to SPA / transform.
        const mw = createSessionMiddleware(sessionDir);
        server.middlewares.use(mw);
      },
      configurePreviewServer(server) {
        server.middlewares.use(createSessionMiddleware(sessionDir));
      },
    },
  ],
  resolve: {
    alias: {
      "@intelligent-ui/renderer-react/styles.css": path.resolve(
        __dirname,
        "../../packages/renderer-react/dist/styles.css",
      ),
      "@intelligent-ui/renderer-react": path.resolve(
        __dirname,
        "../../packages/renderer-react/dist/index.js",
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Helpful when agent browsers rewrite Origin (localhost vs 127.0.0.1).
    cors: true,
    fs: { allow: fsAllow },
    // Avoid full-page death on brief WS blips; API still retries on client.
    hmr: { host: "127.0.0.1", port: 5173 },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
  envPrefix: ["VITE_", "IUI_"],
});
