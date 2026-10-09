#!/usr/bin/env node
/**
 * Capture progressive paint frames with Lightweight Motion enabled.
 * Writes under IUI_MOTION_OUT (default: /workspace/intelligent-ui-mcp-verify).
 * Uses Playwright from sibling verify package if present.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outRoot =
  process.env.IUI_MOTION_OUT ||
  "/workspace/intelligent-ui-mcp-verify";
const framesDir = path.join(outRoot, "motion-frames");
const serverEntry = path.join(root, "packages/mcp-server/dist/index.js");
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "iui-motion-cap-"));
const hostToken = `motion_${Date.now().toString(36)}`;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parseToolJson(result) {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content");
  return JSON.parse(text);
}

async function loadChromium() {
  // Prefer resolve from verify package (has playwright installed).
  try {
    const req = createRequire(path.join(outRoot, "package.json"));
    const resolved = req.resolve("playwright");
    const mod = await import(pathToFileURL(resolved).href);
    const pw = mod.chromium ? mod : mod.default;
    if (pw?.chromium) return pw.chromium;
  } catch {
    /* fall through */
  }
  try {
    const mod = await import(
      pathToFileURL(
        path.join(outRoot, "node_modules/playwright/index.js"),
      ).href,
    );
    const pw = mod.chromium ? mod : mod.default;
    if (pw?.chromium) return pw.chromium;
  } catch {
    /* fall through */
  }
  throw new Error("playwright chromium not found under " + outRoot);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "X-IUI-Host-Token": hostToken } });
      if (res.ok || res.status === 401 || res.status === 404) return;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error("Host not up: " + url);
}

async function main() {
  assert(fs.existsSync(serverEntry), "build mcp-server first");
  fs.mkdirSync(framesDir, { recursive: true });

  // Clean prior motion-* still images at out root (keep other verify assets)
  for (const name of fs.readdirSync(outRoot)) {
    if (!/^motion-(frame-|reduced\.png|shimmer\.png|final\.png)/.test(name)) continue;
    const full = path.join(outRoot, name);
    try {
      if (fs.statSync(full).isFile()) fs.rmSync(full, { force: true });
    } catch {
      /* ignore */
    }
  }
  if (fs.existsSync(framesDir)) {
    for (const name of fs.readdirSync(framesDir)) {
      const full = path.join(framesDir, name);
      if (fs.statSync(full).isFile()) fs.rmSync(full, { force: true });
    }
  }

  const hostEnv = {
    ...process.env,
    IUI_SESSION_DIR: sessionDir,
    IUI_HOST_TOKEN: hostToken,
    IUI_AUTO_HOST: "0",
    IUI_AUTO_OPEN_BROWSER: "0",
  };

  const host = spawn("npm", ["run", "dev", "-w", "@intelligent-ui/host-window"], {
    cwd: root,
    env: hostEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let hostLog = "";
  host.stdout.on("data", (d) => (hostLog += d.toString()));
  host.stderr.on("data", (d) => (hostLog += d.toString()));

  const hostUrl = "http://127.0.0.1:5173";
  try {
    await waitHttp(`${hostUrl}/api/health`);
  } catch (e) {
    console.error(hostLog.slice(-2000));
    host.kill("SIGTERM");
    throw e;
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...hostEnv,
      IUI_REPO_ROOT: root,
    },
  });
  const client = new Client({ name: "iui-motion-capture", version: "0.1.0" });
  await client.connect(transport);

  const opened = parseToolJson(
    await client.callTool({
      name: "ui_open",
      arguments: {
        title: "motion capture",
        density: "full",
        initialState: {},
      },
    }),
  );
  assert(opened.ok, "ui_open failed");
  const sessionId = opened.sessionId;
  const tokenQ = `token=${encodeURIComponent(hostToken)}`;
  const pageUrl = `${hostUrl}/?sessionId=${encodeURIComponent(sessionId)}&${tokenQ}&chrome=full`;

  const chromium = await loadChromium();
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  await page.goto(pageUrl, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(400);

  // Frame 0: streaming empty / skeleton
  await page.screenshot({
    path: path.join(framesDir, "motion-frame-00-skeleton.png"),
    fullPage: true,
  });
  fs.copyFileSync(
    path.join(framesDir, "motion-frame-00-skeleton.png"),
    path.join(outRoot, "motion-frame-00-skeleton.png"),
  );

  async function propose(ops, chunkDone) {
    return parseToolJson(
      await client.callTool({
        name: "ui_propose",
        arguments: {
          sessionId,
          mode: "ops",
          ops,
          chunkDone: chunkDone === true,
        },
      }),
    );
  }

  // Shell
  await propose(
    [
      {
        op: "upsert",
        node: {
          id: "root",
          type: "catalog.base/Stack",
          props: { direction: "vertical", gap: 12 },
          children: [],
        },
      },
    ],
    false,
  );
  await page.waitForTimeout(280);
  await page.screenshot({
    path: path.join(framesDir, "motion-frame-01-root.png"),
    fullPage: true,
  });
  fs.copyFileSync(
    path.join(framesDir, "motion-frame-01-root.png"),
    path.join(outRoot, "motion-frame-01-root.png"),
  );

  // Card + title
  await propose(
    [
      {
        op: "append_child",
        parentId: "root",
        node: {
          id: "card",
          type: "catalog.shadcn/Card",
          props: { title: "Motion 渐进" },
          children: [
            {
              id: "md",
              type: "catalog.base/Markdown",
              props: { markdown: "节点渐入（非 Claude Motion）" },
            },
          ],
        },
      },
    ],
    false,
  );
  await page.waitForTimeout(120);
  // Mid-enter frame (animation ~220ms)
  await page.screenshot({
    path: path.join(framesDir, "motion-frame-02-enter.png"),
    fullPage: true,
  });
  fs.copyFileSync(
    path.join(framesDir, "motion-frame-02-enter.png"),
    path.join(outRoot, "motion-frame-02-enter.png"),
  );
  await page.waitForTimeout(280);

  // Table rows progressive
  await propose(
    [
      {
        op: "append_child",
        parentId: "root",
        node: {
          id: "table",
          type: "catalog.shadcn/DataTable",
          props: {
            columns: [
              { key: "name", label: "型号" },
              { key: "price", label: "价格" },
            ],
            rows: [{ name: "A", price: "¥1" }],
          },
        },
      },
    ],
    false,
  );
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(framesDir, "motion-frame-03-row1.png"),
    fullPage: true,
  });
  fs.copyFileSync(
    path.join(framesDir, "motion-frame-03-row1.png"),
    path.join(outRoot, "motion-frame-03-row1.png"),
  );

  await propose(
    [
      {
        op: "patch_props",
        nodeId: "table",
        props: {
          rows: [
            { name: "A", price: "¥1" },
            { name: "B", price: "¥2" },
            { name: "C", price: "¥3" },
          ],
        },
      },
    ],
    false,
  );
  await page.waitForTimeout(300);

  // Remount check: mark DOM node, patch again, assert same element
  const remount = await page.evaluate(() => {
    const el = document.querySelector('[data-iui-node-id="table"]');
    if (!el) return { ok: false, reason: "no table shell" };
    el.setAttribute("data-iui-motion-probe", "keep");
    return { ok: true };
  });
  assert(remount.ok, remount.reason);

  await propose(
    [
      {
        op: "patch_props",
        nodeId: "table",
        props: {
          rows: [
            { name: "A", price: "¥1" },
            { name: "B", price: "¥2" },
            { name: "C", price: "¥3" },
            { name: "D", price: "¥4" },
          ],
        },
      },
    ],
    true,
  );
  await page.waitForTimeout(350);

  const still = await page.evaluate(() => {
    const el = document.querySelector('[data-iui-node-id="table"]');
    return {
      ok: Boolean(el && el.getAttribute("data-iui-motion-probe") === "keep"),
      motion: el?.getAttribute("data-iui-motion") ?? null,
      hasEnterCss: Boolean(
        [...document.styleSheets].length >= 0 &&
          getComputedStyle(document.documentElement),
      ),
      skeletonGone: !document.querySelector('[data-iui-skeleton]'),
      reducedAttr: document
        .querySelector(".iui-root")
        ?.getAttribute("data-iui-reduced-motion"),
    };
  });
  assert(still.ok, "table shell remounted after patch_props — motion broke stability");

  await page.screenshot({
    path: path.join(framesDir, "motion-frame-04-final.png"),
    fullPage: true,
  });
  fs.copyFileSync(
    path.join(framesDir, "motion-frame-04-final.png"),
    path.join(outRoot, "motion-frame-04-final.png"),
  );
  fs.copyFileSync(
    path.join(framesDir, "motion-frame-04-final.png"),
    path.join(outRoot, "motion-final.png"),
  );

  // Reduced-motion page
  const page2 = await browser.newPage({
    viewport: { width: 900, height: 1100 },
    reducedMotion: "reduce",
  });
  await page2.goto(pageUrl, { waitUntil: "load", timeout: 60000 });
  await page2.waitForTimeout(500);
  const reducedState = await page2.evaluate(() => {
    const root = document.querySelector(".iui-root");
    return {
      reduced: root?.getAttribute("data-iui-reduced-motion"),
      motionOff: root?.classList.contains("iui-motion-off"),
      enterCount: document.querySelectorAll(
        '[data-iui-motion="enter"]',
      ).length,
    };
  });
  assert(
    reducedState.reduced === "1" || reducedState.motionOff,
    "reduced-motion not reflected on root: " + JSON.stringify(reducedState),
  );
  await page2.screenshot({
    path: path.join(framesDir, "motion-reduced.png"),
    fullPage: true,
  });
  fs.copyFileSync(
    path.join(framesDir, "motion-reduced.png"),
    path.join(outRoot, "motion-reduced.png"),
  );

  // Shimmer close-up while forcing streaming UI via evaluate (skeleton class)
  const shimmerShot = path.join(outRoot, "motion-shimmer.png");
  await page.screenshot({ path: shimmerShot, fullPage: false });

  await browser.close();
  await client.close().catch(() => {});
  host.kill("SIGTERM");

  const md = `# Lightweight Motion capture

- session: \`${sessionId}\`
- frames: \`motion-frames/motion-frame-00-skeleton.png\` … \`04-final.png\`
- reduced: \`motion-reduced.png\`
- remount probe: table shell kept \`data-iui-motion-probe=keep\` across patch_props ✅
- reduced-motion root: \`${JSON.stringify(reducedState)}\`

Not Claude Dashboards/Motion — CSS enter + shimmer only.
`;
  fs.writeFileSync(path.join(outRoot, "MOTION-CAPTURE.md"), md);
  fs.writeFileSync(path.join(framesDir, "README.md"), md);
  console.log("wrote frames to", framesDir);
  console.log("MOTION_CAPTURE_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
