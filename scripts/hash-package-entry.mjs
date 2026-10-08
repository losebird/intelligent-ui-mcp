#!/usr/bin/env node
/** Print sha256-<hex> for a renderer entry file (write into manifest.renderer.hash). */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/hash-package-entry.mjs <entry.js>");
  process.exit(1);
}
const abs = path.resolve(file);
const hex = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
console.log(`sha256-${hex}`);
