#!/usr/bin/env node
/**
 * Custom-package sandbox trust-boundary smoke (no browser):
 * 1) register acme.gauges → GET /api/package-entry returns source (authed)
 * 2) unauthenticated package-entry → 401
 * 3) unknown package id → 404
 * 4) protocol + bootstrap srcdoc include CSP connect-src 'none' and sandbox channel
 * 5) bootstrap must NOT request allow-same-origin
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startSessionApiServer } from "../apps/host-window/server/sessionApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverEntry = path.join(root, "packages/mcp-server/dist/index.js");
const examplePkg = path.join(root, "examples/custom-packages/acme-gauges");
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "iui-sandbox-smoke-"));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parseToolJson(result) {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

function authHeaders(token, extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${token}`,
    "X-IUI-Host-Token": token,
  };
}

async function main() {
  if (!fs.existsSync(serverEntry)) {
    console.error("Missing built server — run npm run build first");
    process.exit(1);
  }
  const entryFile = path.join(examplePkg, "dist/render.js");
  assert(fs.existsSync(entryFile), "missing acme-gauges dist/render.js");

  // Static protocol / bootstrap checks (source of truth in Host)
  const protocolSrc = fs.readFileSync(
    path.join(root, "apps/host-window/src/sandbox/protocol.ts"),
    "utf8",
  );
  assert(protocolSrc.includes("iui.sandbox.v1"), "protocol channel missing");
  const bootSrc = fs.readFileSync(
    path.join(root, "apps/host-window/src/sandbox/bootstrapSrcdoc.ts"),
    "utf8",
  );
  assert(bootSrc.includes("connect-src 'none'"), "CSP connect-src none missing");
  assert(bootSrc.includes("allow-scripts"), "docs should mention allow-scripts only");
  assert(!/allow-same-origin/.test(bootSrc), "bootstrap must not enable allow-same-origin");
  const slotSrc = fs.readFileSync(
    path.join(root, "apps/host-window/src/sandbox/SandboxedCustomSlot.tsx"),
    "utf8",
  );
  assert(
    /sandbox=["']allow-scripts["']/.test(slotSrc),
    "iframe sandbox must be allow-scripts only",
  );
  assert(!/allow-same-origin/.test(slotSrc), "iframe must not set allow-same-origin");
  console.log("static sandbox checks ok");

  const hostToken = `sandbox_${randomBytes(16).toString("hex")}`;
  process.env.IUI_HOST_TOKEN = hostToken;

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...process.env,
      IUI_SESSION_DIR: sessionDir,
      IUI_REPO_ROOT: root,
      IUI_HOST_TOKEN: hostToken,
    },
  });
  const client = new Client({ name: "iui-sandbox-smoke", version: "0.1.0" });
  await client.connect(transport);

  const reg = parseToolJson(
    await client.callTool({
      name: "register_package",
      arguments: { path: examplePkg, enable: true, strictHash: true },
    }),
  );
  assert(reg.ok, "register_package failed: " + JSON.stringify(reg));
  console.log("register_package ok");

  const api = await startSessionApiServer({ sessionDir, port: 0, hostToken });
  const base = `http://127.0.0.1:${api.port}`;

  try {
    const unauth = await fetch(`${base}/api/package-entry/acme.gauges`);
    assert(unauth.status === 401, `expected 401, got ${unauth.status}`);
    console.log("package-entry unauth 401 ok");

    const missing = await fetch(`${base}/api/package-entry/does.not.exist`, {
      headers: authHeaders(hostToken),
    });
    assert(missing.status === 404, `expected 404, got ${missing.status}`);
    const missingBody = await missing.json();
    assert(missingBody.error === "PACKAGE_NOT_REGISTERED", JSON.stringify(missingBody));
    console.log("package-entry unknown 404 ok");

    const ok = await fetch(`${base}/api/package-entry/acme.gauges`, {
      headers: authHeaders(hostToken),
    });
    assert(ok.status === 200, `expected 200, got ${ok.status}`);
    const body = await ok.json();
    assert(body.ok && typeof body.source === "string", "missing source");
    assert(body.source.includes("export function Gauge"), "source missing Gauge");
    assert(body.source.includes('from "react"') || body.source.includes("from 'react'"), "expected react import");
    console.log("package-entry source ok, bytes=", body.bytes);

    // CORS denied for non-loopback
    const cors = await fetch(`${base}/api/package-entry/acme.gauges`, {
      headers: authHeaders(hostToken, { Origin: "https://evil.example" }),
    });
    assert(cors.status === 403, `expected CORS 403, got ${cors.status}`);
    console.log("package-entry CORS 403 ok");
  } finally {
    await api.close();
    await client.close();
  }

  console.log("SANDBOX_SMOKE_OK");
  console.log("sessionDir:", sessionDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
