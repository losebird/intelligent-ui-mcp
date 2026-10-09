#!/usr/bin/env node
/**
 * P0 progressive-paint smoke:「对比三款手机」
 *
 * Streams mode=ops (shell → headers → row×3) and asserts Host-visible snapshots
 * grow after each upsert (revision + row count). Also exercises streaming_chunks
 * JSONL (one op per line applied before chunkDone).
 *
 * No desktop screenshots. Optional: leave session under IUI_SESSION_DIR for Host.
 *
 * Usage:
 *   npm run stream-phone-compare
 *   IUI_SESSION_DIR=~/.intelligent-ui-mcp/phone-compare npm run stream-phone-compare
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { startSessionApiServer } from "../apps/host-window/server/sessionApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverEntry = path.join(root, "packages/mcp-server/dist/index.js");

const keepDir = Boolean(process.env.IUI_SESSION_DIR);
const sessionDir =
  process.env.IUI_SESSION_DIR ??
  fs.mkdtempSync(path.join(os.tmpdir(), "iui-phone-compare-"));

function parseToolJson(result) {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function readSnapshot(sessionId) {
  const p = path.join(sessionDir, `${sessionId}.snapshot.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function readEvents(sessionId) {
  const p = path.join(sessionDir, `${sessionId}.ndjson`);
  return fs
    .readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function findNode(tree, id) {
  if (!tree) return null;
  if (tree.id === id) return tree;
  for (const c of tree.children ?? []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}

function rowCount(snap) {
  const table = findNode(snap.tree, "phone_table");
  const rows = table?.props?.rows;
  return Array.isArray(rows) ? rows.length : -1;
}

const COLUMNS = [
  { id: "model", header: "机型" },
  { id: "chip", header: "芯片" },
  { id: "battery", header: "续航" },
  { id: "price", header: "价格" },
];

const PHONES = [
  {
    model: "iPhone 16 Pro",
    chip: "A18 Pro",
    battery: "约一天半",
    price: "¥9999 起",
  },
  {
    model: "Pixel 9 Pro",
    chip: "Tensor G4",
    battery: "约一天",
    price: "¥6999 起",
  },
  {
    model: "Galaxy S25 Ultra",
    chip: "Snapdragon 8 Elite",
    battery: "约两天",
    price: "¥9699 起",
  },
];

async function main() {
  if (!fs.existsSync(serverEntry)) {
    console.error("Missing built server:", serverEntry, "— run npm run build first");
    process.exit(1);
  }

  if (keepDir) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  console.log("IUI_SESSION_DIR:", sessionDir);
  console.log("(Open Host with same dir: IUI_SESSION_DIR=… npm run host → http://127.0.0.1:5173)");

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...process.env,
      IUI_SESSION_DIR: sessionDir,
      IUI_AUTO_HOST: "0",
      IUI_AUTO_OPEN_BROWSER: "0",
    },
  });
  const client = new Client({ name: "iui-phone-compare", version: "0.1.0" });
  await client.connect(transport);

  const frames = [];
  const t0 = Date.now();

  const opened = parseToolJson(
    await client.callTool({
      name: "ui_open",
      arguments: {
        title: "对比三款手机",
        query: "对比三款手机",
        density: "full",
      },
    }),
  );
  assert(opened.ok, "ui_open failed: " + JSON.stringify(opened));
  assert(opened.hostHint, "ui_open should return hostHint");
  const sessionId = opened.sessionId;
  console.log("sessionId:", sessionId);
  console.log("hostHint:", opened.hostHint);

  // --- Frame 1: shell ---
  {
    const r = parseToolJson(
      await client.callTool({
        name: "ui_propose",
        arguments: {
          sessionId,
          mode: "ops",
          chunkDone: false,
          ops: [
            {
              op: "replace_tree",
              tree: {
                id: "root",
                type: "catalog.base/Stack",
                props: { direction: "vertical", gap: 12 },
                children: [
                  {
                    id: "title",
                    type: "catalog.base/Markdown",
                    props: { text: "## 对比三款手机\n生成中…" },
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    assert(r.ok, "shell failed: " + JSON.stringify(r));
    assert(r.status === "streaming", "expected streaming after shell");
    assert(r.partial === true, "expected partial=true");
    const snap = readSnapshot(sessionId);
    const frame = {
      step: "shell",
      ms: Date.now() - t0,
      revision: r.revision,
      status: r.status,
      partial: snap.partial,
      rows: rowCount(snap),
      hasTitle: Boolean(findNode(snap.tree, "title")),
    };
    frames.push(frame);
    console.log("frame:", frame);
  }

  // --- Frame 2: table headers (empty rows) ---
  {
    const r = parseToolJson(
      await client.callTool({
        name: "ui_propose",
        arguments: {
          sessionId,
          mode: "ops",
          chunkDone: false,
          ops: [
            {
              op: "upsert",
              parentId: "root",
              nodeId: "phone_table",
              node: {
                id: "phone_table",
                type: "catalog.shadcn/DataTable",
                props: {
                  caption: "旗舰对比",
                  columns: COLUMNS,
                  rows: [],
                },
              },
            },
          ],
        },
      }),
    );
    assert(r.ok, "headers failed: " + JSON.stringify(r));
    const snap = readSnapshot(sessionId);
    const table = findNode(snap.tree, "phone_table");
    assert(table, "phone_table missing");
    assert(Array.isArray(table.props?.columns) && table.props.columns.length === 4, "columns missing");
    const frame = {
      step: "headers",
      ms: Date.now() - t0,
      revision: r.revision,
      status: r.status,
      partial: snap.partial,
      rows: rowCount(snap),
    };
    frames.push(frame);
    console.log("frame:", frame);
    assert(frame.rows === 0, "headers frame should have 0 rows");
  }

  // --- Frames 3–5: rows ---
  for (let i = 0; i < PHONES.length; i++) {
    const done = i === PHONES.length - 1;
    const rows = PHONES.slice(0, i + 1);
    const r = parseToolJson(
      await client.callTool({
        name: "ui_propose",
        arguments: {
          sessionId,
          mode: "ops",
          chunkDone: done,
          ops: [
            {
              op: "patch_props",
              nodeId: "phone_table",
              props: { rows },
            },
            ...(done
              ? [
                  {
                    op: "patch_props",
                    nodeId: "title",
                    props: { text: "## 对比三款手机\n已生成完（流式 ops）" },
                  },
                ]
              : []),
          ],
        },
      }),
    );
    assert(r.ok, `row ${i} failed: ` + JSON.stringify(r));
    const snap = readSnapshot(sessionId);
    const frame = {
      step: `row_${i + 1}`,
      ms: Date.now() - t0,
      revision: r.revision,
      status: r.status,
      partial: snap.partial,
      rows: rowCount(snap),
    };
    frames.push(frame);
    console.log("frame:", frame);
    assert(frame.rows === i + 1, `expected ${i + 1} rows, got ${frame.rows}`);
    if (!done) {
      assert(r.status === "streaming", "mid-stream should be streaming");
      assert(snap.partial === true, "mid-stream snapshot partial");
    } else {
      assert(r.status === "idle", "final should be idle");
      assert(snap.partial === false, "final snapshot not partial");
    }
  }

  // Progressive assertions
  assert(frames.length >= 5, "need ≥5 frames");
  for (let i = 1; i < frames.length; i++) {
    assert(
      frames[i].revision > frames[i - 1].revision,
      `revision should increase: ${frames[i - 1].revision} → ${frames[i].revision}`,
    );
  }
  assert(frames[0].ms < 3000, "first paint (shell) should be fast in smoke");
  const events = readEvents(sessionId);
  const deltas = events.filter((e) => e.type === "ui.delta");
  assert(deltas.length >= 5, `expected ≥5 ui.delta, got ${deltas.length}`);
  console.log(`ops path: ${deltas.length} ui.delta events, frames=${frames.length}`);

  // --- Part A2: Host SSE + HTTP snapshot prove shards are Host-visible ---
  {
    const hostToken = `phone_sse_${randomBytes(8).toString("hex")}`;
    const api = await startSessionApiServer({ sessionDir, port: 0, hostToken });
    const openedSse = parseToolJson(
      await client.callTool({
        name: "ui_open",
        arguments: { title: "SSE progressive paint", density: "full" },
      }),
    );
    assert(openedSse.ok, "ui_open sse session failed");
    const sidSse = openedSse.sessionId;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    const res = await fetch(
      `http://127.0.0.1:${api.port}/api/stream?sessionId=${encodeURIComponent(sidSse)}`,
      {
        headers: {
          Authorization: `Bearer ${hostToken}`,
          "X-IUI-Host-Token": hostToken,
          Accept: "text/event-stream",
        },
        signal: ac.signal,
      },
    );
    assert(res.ok, `SSE status ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const sseDeltaRevs = [];

    const pumpSse = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          let event = "message";
          const dataLines = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
          }
          if (!dataLines.length) continue;
          let data;
          try {
            data = JSON.parse(dataLines.join("\n"));
          } catch {
            continue;
          }
          if (event === "ui" && data?.type === "ui.delta" && typeof data.revision === "number") {
            sseDeltaRevs.push(data.revision);
          }
        }
      }
    })();

    async function hostSnapshotRows() {
      const r = await fetch(
        `http://127.0.0.1:${api.port}/api/snapshot/${encodeURIComponent(sidSse)}`,
        {
          headers: {
            Authorization: `Bearer ${hostToken}`,
            "X-IUI-Host-Token": hostToken,
          },
        },
      );
      assert(r.ok, `snapshot HTTP ${r.status}`);
      const body = await r.json();
      assert(body.ok && body.snapshot, "snapshot body missing");
      return {
        revision: body.snapshot.revision,
        partial: body.snapshot.partial,
        rows: rowCount(body.snapshot),
      };
    }

    const httpFrames = [];

    await client.callTool({
      name: "ui_propose",
      arguments: {
        sessionId: sidSse,
        mode: "ops",
        chunkDone: false,
        ops: [
          {
            op: "replace_tree",
            tree: {
              id: "root",
              type: "catalog.base/Stack",
              props: { direction: "vertical", gap: 8 },
              children: [
                {
                  id: "title",
                  type: "catalog.base/Markdown",
                  props: { text: "## SSE phone compare\n…" },
                },
              ],
            },
          },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    httpFrames.push({ step: "shell", ...(await hostSnapshotRows()) });

    await client.callTool({
      name: "ui_propose",
      arguments: {
        sessionId: sidSse,
        mode: "ops",
        chunkDone: false,
        ops: [
          {
            op: "upsert",
            parentId: "root",
            nodeId: "phone_table",
            node: {
              id: "phone_table",
              type: "catalog.shadcn/DataTable",
              props: { columns: COLUMNS, rows: [] },
            },
          },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    httpFrames.push({ step: "headers", ...(await hostSnapshotRows()) });
    assert(httpFrames.at(-1).rows === 0, "headers must paint 0 rows");
    assert(httpFrames.at(-1).partial === true, "headers still partial");

    for (let i = 0; i < PHONES.length; i++) {
      const done = i === PHONES.length - 1;
      await client.callTool({
        name: "ui_propose",
        arguments: {
          sessionId: sidSse,
          mode: "ops",
          chunkDone: done,
          ops: [
            {
              op: "patch_props",
              nodeId: "phone_table",
              props: { rows: PHONES.slice(0, i + 1) },
            },
          ],
        },
      });
      await new Promise((r) => setTimeout(r, 50));
      httpFrames.push({ step: `row_${i + 1}`, ...(await hostSnapshotRows()) });
      assert(
        httpFrames.at(-1).rows === i + 1,
        `Host snapshot rows want ${i + 1} got ${httpFrames.at(-1).rows}`,
      );
    }
    assert(httpFrames.at(-1).partial === false, "final Host snapshot not partial");

    await new Promise((r) => setTimeout(r, 300));
    clearTimeout(timer);
    ac.abort();
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    try {
      await pumpSse;
    } catch {
      /* abort */
    }

    const uniqueDeltaRevs = [...new Set(sseDeltaRevs)].sort((a, b) => a - b);
    assert(
      uniqueDeltaRevs.length >= 4,
      `SSE ui.delta should cover ≥4 revisions, got ${uniqueDeltaRevs.join(",")}`,
    );
    for (let i = 1; i < httpFrames.length; i++) {
      assert(
        httpFrames[i].revision > httpFrames[i - 1].revision,
        `Host revision must grow: ${JSON.stringify(httpFrames)}`,
      );
    }
    console.log("SSE+Host progressive OK:", { uniqueDeltaRevs, httpFrames });
    await api.close();
  }

  // --- Part B: streaming_chunks JSONL progressive apply ---
  const opened2 = parseToolJson(
    await client.callTool({
      name: "ui_open",
      arguments: { title: "JSONL phone stream", sessionId: undefined },
    }),
  );
  assert(opened2.ok, "ui_open#2 failed");
  const sid2 = opened2.sessionId;

  const jsonlOps = [
    {
      op: "replace_tree",
      tree: {
        id: "root",
        type: "catalog.base/Stack",
        props: { direction: "vertical", gap: 8 },
        children: [],
      },
    },
    {
      op: "upsert",
      parentId: "root",
      nodeId: "phone_table",
      node: {
        id: "phone_table",
        type: "catalog.shadcn/DataTable",
        props: { columns: COLUMNS, rows: [] },
      },
    },
    {
      op: "patch_props",
      nodeId: "phone_table",
      props: { rows: [PHONES[0]] },
    },
    {
      op: "patch_props",
      nodeId: "phone_table",
      props: { rows: PHONES.slice(0, 2) },
    },
    {
      op: "patch_props",
      nodeId: "phone_table",
      props: { rows: PHONES },
    },
  ];

  let appliedTotal = 0;
  const jsonlFrames = [];
  for (let i = 0; i < jsonlOps.length; i++) {
    const line = JSON.stringify(jsonlOps[i]) + "\n";
    const done = i === jsonlOps.length - 1;
    const r = parseToolJson(
      await client.callTool({
        name: "ui_propose",
        arguments: {
          sessionId: sid2,
          mode: "streaming_chunks",
          chunk: line,
          chunkIndex: i,
          chunkDone: done,
        },
      }),
    );
    assert(r.ok, `jsonl chunk ${i} failed: ` + JSON.stringify(r));
    appliedTotal += r.appliedOps ?? 0;
    const snap = readSnapshot(sid2);
    const jf = {
      step: `jsonl_${i}`,
      revision: r.revision,
      appliedOps: r.appliedOps ?? 0,
      rows: rowCount(snap),
      status: r.status,
      partial: snap.partial,
    };
    jsonlFrames.push(jf);
    console.log("jsonl frame:", jf);
    // After headers line (i>=1) table exists; after first patch_props rows grow
    if (i >= 2) {
      assert(jf.rows >= 1, "JSONL should paint rows before chunkDone completes all");
    }
  }
  assert(appliedTotal >= 5, `expected ≥5 applied JSONL ops, got ${appliedTotal}`);
  const finalSnap = readSnapshot(sid2);
  assert(rowCount(finalSnap) === 3, "JSONL final should have 3 rows");
  assert(finalSnap.status === "idle", "JSONL final idle");

  const ev2 = readEvents(sid2);
  const d2 = ev2.filter((e) => e.type === "ui.delta");
  assert(d2.length >= 5, `JSONL expected ≥5 ui.delta, got ${d2.length}`);

  console.log("\nOK progressive paint smoke passed");
  console.log(
    JSON.stringify(
      {
        sessionId,
        sessionDir,
        hostUrl: opened.hostUrl ?? "http://127.0.0.1:5173",
        frames,
        jsonlSessionId: sid2,
        jsonlFrames,
      },
      null,
      2,
    ),
  );

  await client.close();
  if (!keepDir) {
    // leave tmp for inspection briefly? remove
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
