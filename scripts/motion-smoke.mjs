#!/usr/bin/env node
/**
 * Lightweight Motion smoke (no Claude Motion claim):
 * 1) Static: NodeMotionShell key=node.id path; CSS enter + reduced-motion; skeleton
 * 2) Built exports present
 * 3) Optional: if MOTION_CAPTURE=1 and playwright available, run capture
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

async function main() {
  const uiSrc = read("packages/renderer-react/src/UiRenderer.tsx");
  assert(uiSrc.includes("NodeMotionShell"), "UiRenderer must use NodeMotionShell");
  assert(uiSrc.includes("key={node.id}"), "must key by node.id (no remount)");
  assert(uiSrc.includes("SkeletonPlaceholder"), "must show SkeletonPlaceholder when streaming");
  assert(uiSrc.includes("prefersReducedMotion") || uiSrc.includes("subscribePrefersReducedMotion"), "reduced-motion hook");

  const shellSrc = read("packages/renderer-react/src/motion/NodeMotionShell.tsx");
  assert(shellSrc.includes("data-iui-motion"), "shell sets data-iui-motion");
  assert(shellSrc.includes("animationend"), "shell listens animationend");
  assert(shellSrc.includes("prefersReducedMotion"), "shell skips when reduced");

  const css = read("packages/renderer-react/src/styles.css");
  assert(css.includes("@keyframes iui-node-enter"), "enter keyframes");
  assert(css.includes("@keyframes iui-shimmer-slide"), "shimmer keyframes");
  assert(css.includes("prefers-reduced-motion: reduce"), "CSS reduced-motion");
  assert(css.includes(".iui-skeleton"), "skeleton styles");
  assert(css.includes("animation: none !important"), "reduced kills animation");

  const hostCss = read("apps/host-window/src/host.css");
  assert(hostCss.includes("prefers-reduced-motion"), "host chrome reduced-motion");

  const viewSrc = read("packages/host-adapter/src/react/HostSurfaceView.tsx");
  assert(viewSrc.includes("streaming={"), "HostSurfaceView passes streaming");
  assert(viewSrc.includes("motion={motion}"), "HostSurfaceView passes motion");

  const distCss = path.join(root, "packages/renderer-react/dist/styles.css");
  assert(fs.existsSync(distCss), "build renderer styles.css first");
  const builtCss = fs.readFileSync(distCss, "utf8");
  assert(builtCss.includes("iui-node-enter"), "dist CSS has enter");
  assert(builtCss.includes("prefers-reduced-motion"), "dist CSS has reduced");

  const distIdx = path.join(root, "packages/renderer-react/dist/index.js");
  assert(fs.existsSync(distIdx), "build renderer index first");
  const mod = await import(pathToFileURL(distIdx).href);
  assert(typeof mod.UiRenderer === "function", "UiRenderer export");
  assert(typeof mod.NodeMotionShell === "function", "NodeMotionShell export");
  assert(typeof mod.SkeletonPlaceholder === "function", "SkeletonPlaceholder export");
  assert(typeof mod.prefersReducedMotion === "function", "prefersReducedMotion export");

  const docs = read("docs/LIGHTWEIGHT-MOTION.md");
  assert(docs.includes("不是") && docs.toLowerCase().includes("claude"), "docs disclaim Claude Motion");
  assert(docs.includes("node.id"), "docs mention stable key");

  console.log("static + export checks ok");

  if (process.env.MOTION_CAPTURE === "1") {
    const cap = path.join(root, "scripts/motion-capture.mjs");
    assert(fs.existsSync(cap), "motion-capture.mjs missing");
    console.log("MOTION_CAPTURE=1 → running capture…");
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cap], {
        cwd: root,
        stdio: "inherit",
        env: process.env,
      });
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`capture exit ${code}`)),
      );
    });
  }

  console.log("MOTION_SMOKE_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
