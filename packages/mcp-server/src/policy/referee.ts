/**
 * Optional policy referee (Phase B).
 * Enabled only when IUI_POLICY_ENABLED=1.
 * Backend: IUI_POLICY_ENDPOINT (HTTP POST JSON) and/or IUI_POLICY_CMD (CLI stdin→stdout).
 * Failures/timeouts degrade to Phase A heuristic — never throw to caller.
 */

import { spawn } from "node:child_process";
import { classifyFormat, type ClassifyResult, type FormatDecision } from "./classify.js";

export interface PolicyCheckInput {
  query: string;
  treeSummary?: string;
  plainTextAlternative?: string;
  proposedTypes?: string[];
}

export interface PolicyCheckOutput {
  decision: FormatDecision;
  score: number;
  reasons: string[];
  suggested_types: string[];
  source: "disabled" | "heuristic" | "endpoint" | "cmd" | "fallback";
  enabled: boolean;
}

function timeoutMs(): number {
  const n = Number(process.env.IUI_POLICY_TIMEOUT_MS ?? "5000");
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

export function isPolicyEnabled(): boolean {
  const v = process.env.IUI_POLICY_ENABLED;
  return v === "1" || v === "true" || v === "yes";
}

function normalizeDecision(raw: unknown): FormatDecision | null {
  if (raw === "plain_text" || raw === "plain" || raw === "text") return "plain_text";
  if (raw === "ui" || raw === "UI") return "ui";
  return null;
}

function fromHeuristic(input: PolicyCheckInput): PolicyCheckOutput {
  const c: ClassifyResult = classifyFormat(input.query);
  return {
    decision: c.decision,
    score: c.score,
    reasons: c.reasons,
    suggested_types:
      c.suggested_types.length > 0
        ? c.suggested_types
        : input.proposedTypes ?? [],
    source: "heuristic",
    enabled: true,
  };
}

async function callEndpoint(
  input: PolicyCheckInput,
  url: string,
): Promise<PolicyCheckOutput | null> {
  const ms = timeoutMs();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    const decision = normalizeDecision(body.decision);
    if (!decision) return null;
    return {
      decision,
      score: typeof body.score === "number" ? body.score : 0.7,
      reasons: Array.isArray(body.reasons)
        ? body.reasons.map(String)
        : ["endpoint referee"],
      suggested_types: Array.isArray(body.suggested_types)
        ? body.suggested_types.map(String)
        : Array.isArray(body.suggestedTypes)
          ? (body.suggestedTypes as unknown[]).map(String)
          : [],
      source: "endpoint",
      enabled: true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callCmd(
  input: PolicyCheckInput,
  cmd: string,
): Promise<PolicyCheckOutput | null> {
  const ms = timeoutMs();
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let settled = false;
    const finish = (v: PolicyCheckOutput | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, ms);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish(null);
        return;
      }
      try {
        const body = JSON.parse(stdout.trim()) as Record<string, unknown>;
        const decision = normalizeDecision(body.decision);
        if (!decision) {
          finish(null);
          return;
        }
        finish({
          decision,
          score: typeof body.score === "number" ? body.score : 0.7,
          reasons: Array.isArray(body.reasons)
            ? body.reasons.map(String)
            : ["cmd referee"],
          suggested_types: Array.isArray(body.suggested_types)
            ? body.suggested_types.map(String)
            : [],
          source: "cmd",
          enabled: true,
        });
      } catch {
        finish(null);
      }
    });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

/**
 * Run policy check. If disabled → enabled:false + heuristic decision for callers that still want a hint.
 */
export async function policyCheck(
  input: PolicyCheckInput,
): Promise<PolicyCheckOutput> {
  const query = input.query ?? "";

  if (!isPolicyEnabled()) {
    const h = fromHeuristic(input);
    return {
      ...h,
      source: "disabled",
      enabled: false,
      reasons: ["IUI_POLICY_ENABLED not set — Phase A heuristic only (not applied as gate)"],
    };
  }

  const endpoint = process.env.IUI_POLICY_ENDPOINT?.trim();
  const cmd = process.env.IUI_POLICY_CMD?.trim();

  if (endpoint) {
    const r = await callEndpoint(input, endpoint);
    if (r) return r;
  }
  if (cmd) {
    const r = await callCmd(input, cmd);
    if (r) return r;
  }

  // No backend or failed → Phase A heuristic fallback
  const h = fromHeuristic({ ...input, query });
  return {
    ...h,
    source: "fallback",
    reasons: [
      ...h.reasons,
      endpoint || cmd
        ? "referee failed/timeout → Phase A heuristic"
        : "no IUI_POLICY_ENDPOINT/CMD → Phase A heuristic",
    ],
  };
}
