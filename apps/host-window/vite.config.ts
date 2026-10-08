import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, PreviewServer, ViteDevServer } from "vite";
import {
  createSessionMiddleware,
  resolveSessionDir,
} from "./server/sessionApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionDir = resolveSessionDir();
const repoRoot = path.resolve(__dirname, "../..");
const homeIui = path.join(os.homedir(), ".intelligent-ui-mcp");
const trustedExtra = (process.env.IUI_TRUSTED_DIRS ?? "")
  .split(/[:;]/)
  .map((s) => s.trim())
  .filter(Boolean);
const fsAllow = [
  repoRoot,
  path.join(homeIui, "trusted"),
  ...trustedExtra,
];

type MwServer = ViteDevServer | PreviewServer;

/** Allow Cursor Simple Browser / local iframe panels to embed Host (P1). */
function installEmbedHeaders(server: MwServer) {
  server.middlewares.use((_req, res, next) => {
    // Do not set X-Frame-Options (would block embed). Permit any ancestor on loopback demos.
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
    next();
  });
}

function installSessionApi(server: MwServer) {
  const mw = createSessionMiddleware(sessionDir) as Connect.NextHandleFunction;
  // Register during configureServer (before Vite internals) so /api/* never
  // falls through to SPA / transform.
  server.middlewares.use(mw);
  // After Vite installs its stack, keep our handler at the front — HMR/plugin
  // churn sometimes leaves later layers racing /api before ours.
  return () => {
    const stack = (
      server.middlewares as Connect.Server & {
        stack: Array<{ route: string; handle: unknown }>;
      }
    ).stack;
    if (!Array.isArray(stack)) return;
    const idx = stack.findIndex((layer) => layer.handle === mw);
    if (idx > 0) {
      const [layer] = stack.splice(idx, 1);
      stack.unshift(layer);
    }
  };
}

const ignHome = homeIui.replace(/\\/g, "/");
const ignSession = String(sessionDir).replace(/\\/g, "/");

export default defineConfig({
  plugins: [
    react(),
    {
      name: "iui-session-api",
      configureServer(server) {
        installEmbedHeaders(server);
        return installSessionApi(server);
      },
      configurePreviewServer(server) {
        installEmbedHeaders(server);
        return installSessionApi(server);
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
      "@intelligent-ui/host-adapter/react": path.resolve(
        __dirname,
        "../../packages/host-adapter/dist/react/HostSurfaceView.js",
      ),
      "@intelligent-ui/host-adapter": path.resolve(
        __dirname,
        "../../packages/host-adapter/dist/index.js",
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
    // Session NDJSON / snapshot writes must not restart Vite (brief downtime
    // surfaces in the browser as TypeError: Failed to fetch).
    watch: {
      ignored: [
        "**/.git/**",
        "**/node_modules/**",
        `${ignHome}/**`,
        `${ignSession}/**`,
      ],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
  envPrefix: ["VITE_", "IUI_"],
});
