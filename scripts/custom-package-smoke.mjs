#!/usr/bin/env node
/**
 * ④ custom-package smoke:
 * - trusted legal package → register ok → list visible
 * - outside trusted → PATH_NOT_TRUSTED
 * - bad hash → HASH_MISMATCH
 * - unregister → gone from list
 * - propose Gauge → snapshot contains type
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverEntry = path.join(root, "packages/mcp-server/dist/index.js");
const examplePkg = path.join(root, "examples/custom-packages/acme-gauges");
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "iui-custom-smoke-"));

function parseToolJson(result) {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

function sha256File(filePath) {
  const hex = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  return `sha256-${hex}`;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function main() {
  if (!fs.existsSync(serverEntry)) {
    console.error("Missing built server — run npm run build first");
    process.exit(1);
  }
  if (!fs.existsSync(path.join(examplePkg, "manifest.json"))) {
    console.error("Missing example package:", examplePkg);
    process.exit(1);
  }

  // Verify example hash matches entry
  const entry = path.join(examplePkg, "dist/render.js");
  const manifest = JSON.parse(fs.readFileSync(path.join(examplePkg, "manifest.json"), "utf8"));
  const actual = sha256File(entry);
  if (manifest.renderer.hash !== actual) {
    throw new Error(`Example manifest hash stale: ${manifest.renderer.hash} vs ${actual}`);
  }
  console.log("example hash ok:", actual);

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...process.env,
      IUI_SESSION_DIR: sessionDir,
      IUI_AUTO_HOST: "0",
      IUI_AUTO_OPEN_BROWSER: "0",
      IUI_REPO_ROOT: root,
    },
  });
  const client = new Client({ name: "iui-custom-smoke", version: "0.1.0" });
  await client.connect(transport);

  // 1) trusted legal
  const reg = parseToolJson(
    await client.callTool({
      name: "register_package",
      arguments: { path: examplePkg, enable: true },
    }),
  );
  if (!reg.ok) throw new Error("register trusted failed: " + JSON.stringify(reg));
  console.log("register ok:", reg.packageId, reg.components);

  const pkgs = parseToolJson(
    await client.callTool({ name: "list_packages", arguments: { includeDisabled: true } }),
  );
  const ids = pkgs.packages.map((p) => p.id);
  if (!ids.includes("acme.gauges")) throw new Error("list_packages missing acme.gauges");
  const local = pkgs.packages.find((p) => p.id === "acme.gauges");
  if (local.source !== "local") throw new Error("expected source=local");

  const comps = parseToolJson(
    await client.callTool({
      name: "list_components",
      arguments: { packageId: "acme.gauges", enabledOnly: true },
    }),
  );
  const types = comps.components.map((c) => c.type);
  if (!types.includes("acme.gauges/Gauge")) throw new Error("list_components missing Gauge");
  console.log("list visible: acme.gauges/Gauge");

  const registryFile = path.join(sessionDir, "registry.json");
  if (!fs.existsSync(registryFile)) throw new Error("registry.json not written");
  const registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  if (!registry.packages?.some((p) => p.id === "acme.gauges" && p.entryAbsPath)) {
    throw new Error("registry.json missing entryAbsPath for acme.gauges");
  }
  console.log("registry.json ok");

  // 2) outside trusted
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "iui-untrusted-"));
  copyDir(examplePkg, outside);
  const badPath = parseToolJson(
    await client.callTool({
      name: "register_package",
      arguments: { path: outside, strictHash: true },
    }),
  );
  if (badPath.ok || badPath.error?.code !== "PATH_NOT_TRUSTED") {
    throw new Error("expected PATH_NOT_TRUSTED, got " + JSON.stringify(badPath));
  }
  console.log("PATH_NOT_TRUSTED ok");

  // 3) hash mismatch — copy into trusted examples dir under a temp name
  const tamperDir = path.join(root, "examples/custom-packages", `_smoke_tamper_${Date.now()}`);
  try {
    copyDir(examplePkg, tamperDir);
    const tamperManifest = path.join(tamperDir, "manifest.json");
    const m = JSON.parse(fs.readFileSync(tamperManifest, "utf8"));
    m.id = "acme.tamper";
    m.renderer.hash = "sha256-" + "0".repeat(64);
    fs.writeFileSync(tamperManifest, JSON.stringify(m, null, 2));
    const mismatch = parseToolJson(
      await client.callTool({
        name: "register_package",
        arguments: { path: tamperDir, strictHash: true },
      }),
    );
    if (mismatch.ok || mismatch.error?.code !== "HASH_MISMATCH") {
      throw new Error("expected HASH_MISMATCH, got " + JSON.stringify(mismatch));
    }
    console.log("HASH_MISMATCH ok");

    // missing hash
    delete m.renderer.hash;
    m.id = "acme.nohash";
    fs.writeFileSync(tamperManifest, JSON.stringify(m, null, 2));
    const missing = parseToolJson(
      await client.callTool({
        name: "register_package",
        arguments: { path: tamperDir, strictHash: true },
      }),
    );
    if (missing.ok || missing.error?.code !== "HASH_MISSING") {
      throw new Error("expected HASH_MISSING, got " + JSON.stringify(missing));
    }
    console.log("HASH_MISSING ok (strictHash:true)");

    // omit strictHash → still default true → HASH_MISSING
    const missingDefault = parseToolJson(
      await client.callTool({
        name: "register_package",
        arguments: { path: tamperDir },
      }),
    );
    if (missingDefault.ok || missingDefault.error?.code !== "HASH_MISSING") {
      throw new Error("expected default HASH_MISSING, got " + JSON.stringify(missingDefault));
    }
    console.log("HASH_MISSING ok (strictHash omitted / default true)");

    // explicit strictHash:false allows missing hash (warning path)
    m.id = "acme.loosehash";
    fs.writeFileSync(tamperManifest, JSON.stringify(m, null, 2));
    const loose = parseToolJson(
      await client.callTool({
        name: "register_package",
        arguments: { path: tamperDir, strictHash: false },
      }),
    );
    if (!loose.ok) throw new Error("strictHash:false should register: " + JSON.stringify(loose));
    if (!Array.isArray(loose.warnings) || !loose.warnings.some((w) => /strictHash=false|hash missing/i.test(w))) {
      console.log("warnings:", loose.warnings);
    }
    console.log("strictHash:false allow missing hash ok");
    await client.callTool({ name: "unregister", arguments: { packageId: "acme.loosehash" } });
  } finally {
    fs.rmSync(tamperDir, { recursive: true, force: true });
  }

  // 4) propose Gauge node
  const opened = parseToolJson(
    await client.callTool({
      name: "ui_open",
      arguments: { title: "custom-smoke" },
    }),
  );
  if (!opened.ok) throw new Error("ui_open failed");
  const sessionId = opened.sessionId;
  const proposed = parseToolJson(
    await client.callTool({
      name: "ui_propose",
      arguments: {
        sessionId,
        mode: "tree",
        tree: {
          id: "root",
          type: "catalog.base/Stack",
          props: { direction: "vertical", gap: 8 },
          children: [
            {
              id: "g1",
              type: "acme.gauges/Gauge",
              props: { value: 42, max: 100, label: "CPU" },
            },
          ],
        },
      },
    }),
  );
  if (!proposed.ok) throw new Error("ui_propose Gauge failed: " + JSON.stringify(proposed));
  const snapPath = path.join(sessionDir, `${sessionId}.snapshot.json`);
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  const treeStr = JSON.stringify(snap.tree);
  if (!treeStr.includes("acme.gauges/Gauge")) {
    throw new Error("snapshot missing acme.gauges/Gauge");
  }
  console.log("propose Gauge → snapshot ok");

  // 5) unregister
  const un = parseToolJson(
    await client.callTool({
      name: "unregister",
      arguments: { packageId: "acme.gauges" },
    }),
  );
  if (!un.ok) throw new Error("unregister failed: " + JSON.stringify(un));
  const pkgs2 = parseToolJson(
    await client.callTool({ name: "list_packages", arguments: {} }),
  );
  if (pkgs2.packages.some((p) => p.id === "acme.gauges")) {
    throw new Error("acme.gauges still listed after unregister");
  }
  const registry2 = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  if (registry2.packages?.some((p) => p.id === "acme.gauges")) {
    throw new Error("registry.json still has acme.gauges");
  }
  console.log("unregister ok");

  // builtin protected
  const unBuiltin = parseToolJson(
    await client.callTool({
      name: "unregister",
      arguments: { packageId: "catalog.base" },
    }),
  );
  if (unBuiltin.ok || unBuiltin.error?.code !== "BUILTIN_PROTECTED") {
    throw new Error("expected BUILTIN_PROTECTED, got " + JSON.stringify(unBuiltin));
  }
  console.log("BUILTIN_PROTECTED ok");

  await client.close();
  console.log("CUSTOM_SMOKE_OK");
  console.log("sessionDir:", sessionDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
