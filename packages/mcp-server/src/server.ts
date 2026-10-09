import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CatalogRegistry } from "./catalog/registry.js";
import { HostRegistryBypass } from "./catalog/host-registry-bypass.js";
import {
  registerPackageFromPath,
  registerComponentHot,
  unregisterPackageOrComponent,
} from "./catalog/register.js";
import { SessionStore } from "./session/store.js";
import { buildPromptFragment } from "./prompt.js";
import { errResult, okResult, textContent } from "./protocol.js";
import type { UiNode } from "./protocol.js";
import type { UiOp } from "./session/ops.js";
import { policyCheck, isPolicyEnabled } from "./policy/referee.js";
import { evaluateExpr } from "./policy/expr.js";
import { ensureHostOnUiOpen } from "./hostLauncher.js";


/** Infer propose mode: explicit > ops[] > chunk > tree (plainText / one-shot). */
function resolveProposeMode(args: {
  mode?: "tree" | "ops" | "streaming_chunks";
  ops?: unknown[];
  chunk?: string;
  tree?: unknown;
}): "tree" | "ops" | "streaming_chunks" {
  if (args.mode) return args.mode;
  if (typeof args.chunk === "string") return "streaming_chunks";
  if (Array.isArray(args.ops) && args.ops.length > 0) return "ops";
  return "tree";
}

export function createIntelligentUiServer(opts: { sessionDir?: string } = {}) {
  const catalog = new CatalogRegistry();
  const sessions = new SessionStore(catalog, opts.sessionDir);
  const hostRegistry = new HostRegistryBypass(sessions.events.dir);
  // Seed empty registry.json so Host can poll immediately
  hostRegistry.writeRegistry(catalog.listHostPackages());

  const server = new McpServer({
    name: "intelligent-ui-mcp",
    version: "0.1.0",
  });

  server.tool(
    "list_packages",
    "List known UI catalogs and their enabled/render status",
    {
      includeDisabled: z.boolean().optional().default(true),
      includeSchemaOnly: z.boolean().optional().default(true),
    },
    async ({ includeDisabled, includeSchemaOnly }) => {
      const packages = catalog.listPackages({ includeDisabled, includeSchemaOnly });
      return textContent(okResult({ packages }));
    },
  );

  server.tool(
    "list_components",
    "List components (optionally filtered by package / query)",
    {
      packageId: z.string().optional(),
      enabledOnly: z.boolean().optional().default(true),
      query: z.string().optional(),
    },
    async ({ packageId, enabledOnly, query }) => {
      const components = catalog.listComponents({ packageId, enabledOnly, query });
      return textContent(okResult({ components }));
    },
  );

  server.tool(
    "set_enabled_packages",
    "Enable/disable packages by id map. catalog.base cannot be disabled.",
    {
      packages: z.record(z.boolean()),
      replaceAll: z.boolean().optional().default(false),
    },
    async ({ packages, replaceAll }) => {
      const result = catalog.setEnabledPackages(packages, replaceAll);
      if (!result.ok) {
        return textContent(errResult(result.code, result.message));
      }
      return textContent(okResult({ enabledPackageIds: result.enabledPackageIds }));
    },
  );

  server.tool(
    "set_enabled_components",
    "Enable/disable individual ComponentTypes",
    {
      components: z.record(z.boolean()),
    },
    async ({ components }) => {
      const enabledTypes = catalog.setEnabledComponents(components);
      return textContent(
        okResult({
          enabledTypesCount: enabledTypes.length,
          enabledTypes: enabledTypes.slice(0, 200),
        }),
      );
    },
  );

  server.tool(
    "get_prompt_fragment",
    "System prompt fragment teaching the model how to use Intelligent UI",
    {
      locale: z.string().optional().default("zh-CN"),
      density: z.enum(["full", "compact", "plain_prefer"]).optional().default("full"),
      includeExamples: z.boolean().optional().default(true),
      maxChars: z.number().int().optional().default(6000),
    },
    async (args) => {
      const { fragment, enabledTypes, version } = buildPromptFragment(catalog, args);
      return textContent(
        okResult({
          fragment,
          enabledTypes,
          version,
          designJudgment:
            "prompt + lint + optional policy referee (≠ OpenAI RL weights)",
        }),
      );
    },
  );

  server.tool(
    "get_json_schema",
    "Fetch JSON Schema for a component or combined UI tree",
    {
      componentType: z.string().optional(),
      scope: z
        .enum(["component", "ui_tree", "ui_delta", "all_enabled"])
        .optional()
        .default("component"),
    },
    async ({ componentType, scope }) => {
      const result = catalog.getJsonSchema({ componentType, scope });
      if (!result.ok) {
        return textContent(errResult(result.code, result.message));
      }
      return textContent(okResult({ schema: result.schema }));
    },
  );

  server.tool(
    "ui_open",
    "Open a UI session; writes ui.open to NDJSON bypass. Probes / auto-spawns reference Host + optional browser; returns hostUrl, embedUrl, openUrl (token), hostReady, hostHint, launchCmd.",
    {
      sessionId: z.string().optional(),
      title: z.string().optional(),
      initialState: z.record(z.unknown()).optional(),
      preferPlainText: z.boolean().optional().default(false),
      density: z.enum(["full", "compact", "plain_prefer"]).optional(),
      meta: z.record(z.unknown()).optional(),
      reducers: z.record(z.string()).optional(),
      query: z.string().optional(),
    },
    async (args) => {
      const result = sessions.open(args);
      if (!result.ok) {
        return textContent(errResult(result.code, result.message));
      }
      const sessionDir = sessions.events.dir;
      const host = await ensureHostOnUiOpen({
        sessionId: result.session.sessionId,
        sessionDir,
      });
      return textContent(
        okResult({
          sessionId: result.session.sessionId,
          state: result.session.state,
          status: result.session.status,
          eventsPath: result.eventsPath,
          actionsPath: sessions.events.actionsPath(result.session.sessionId),
          snapshotPath: sessions.events.snapshotPath(result.session.sessionId),
          sessionDir,
          hostUrl: host.hostUrl,
          embedUrl: host.embedUrl,
          openUrl: host.openUrl,
          hostReady: host.hostReady,
          hostStarted: host.hostStarted,
          browserOpened: host.browserOpened,
          launchCmd: host.launchCmd,
          tokenFile: host.tokenFile,
          hostHint: host.hostHint,
        }),
      );
    },
  );

  server.tool(
    "ui_propose",
    "Propose UI with progressive paint. DEFAULT for comparisons/tables/multi-row lists: mode=ops + chunkDone:false shard upserts (① Stack shell → ② DataTable headers empty rows → ③ row-by-row → ④ final chunkDone:true). Do NOT one-shot a full tree for demos. mode=tree only for tiny single-shot forms/plainTextFallback. mode=streaming_chunks = JSONL ops (one op per line, apply immediately). Omitting mode infers ops if ops[] present, else tree. Omitting chunkDone on ops keeps partial/streaming until chunkDone:true. Optional query/forceUi for policy gate.",
    {
      sessionId: z.string(),
      mode: z.enum(["tree", "ops", "streaming_chunks"]).optional(),
      tree: z.record(z.unknown()).optional(),
      ops: z.array(z.record(z.unknown())).optional(),
      chunk: z.string().optional(),
      chunkIndex: z.number().int().optional(),
      chunkDone: z.boolean().optional(),
      plainTextFallback: z.string().optional(),
      runLint: z.boolean().optional().default(true),
      refresh: z.boolean().optional(),
      targetNodeId: z.string().optional(),
      query: z.string().optional(),
      forceUi: z.boolean().optional().default(false),
    },
    async (args) => {
      const mode = resolveProposeMode(args);
      // Optional policy gate (Phase B): only when enabled + query available
      let policyMeta: Record<string, unknown> | undefined;
      const sessionPeek = sessions.get(args.sessionId);
      const query =
        (typeof args.query === "string" && args.query.trim()) ||
        sessionPeek?.lastQuery ||
        "";
      if (isPolicyEnabled() && query && mode === "tree" && !args.forceUi) {
        const proposedTypes: string[] = [];
        const walk = (n: Record<string, unknown> | undefined) => {
          if (!n || typeof n !== "object") return;
          if (typeof n.type === "string") proposedTypes.push(n.type);
          const kids = n.children;
          if (Array.isArray(kids)) {
            for (const c of kids) walk(c as Record<string, unknown>);
          }
        };
        walk(args.tree as Record<string, unknown> | undefined);
        const pol = await policyCheck({
          query,
          plainTextAlternative: args.plainTextFallback,
          proposedTypes,
          treeSummary: args.tree
            ? `types=${proposedTypes.join(",")}`
            : undefined,
        });
        policyMeta = {
          decision: pol.decision,
          score: pol.score,
          reasons: pol.reasons,
          suggested_types: pol.suggested_types,
          source: pol.source,
        };
        if (pol.decision === "plain_text") {
          return sessions.runLocked(args.sessionId, () => {
            const result = sessions.proposeTree({
              sessionId: args.sessionId,
              tree: undefined,
              plainTextFallback:
                args.plainTextFallback ??
                "(policy: prefer plain text — no UI tree applied)",
              runLint: false,
              query,
              forceUi: false,
            });
            if (!result.ok) {
              return textContent(
                errResult(result.code, result.message, result.lint ? { lint: result.lint } : undefined),
              );
            }
            return textContent(
              okResult({
                sessionId: result.session.sessionId,
                revision: result.session.revision,
                status: result.session.status,
                warnings: [
                  ...result.warnings,
                  "POLICY_PLAIN_TEXT: referee chose plain_text (pass forceUi=true to override)",
                ],
                lint: result.lint,
                decision: "plain_text" as const,
                plainText: result.plainText,
                policy: policyMeta,
                eventsPath: sessions.events.sessionPath(result.session.sessionId),
                snapshotPath: sessions.events.snapshotPath(result.session.sessionId),
              }),
            );
          });
        }
      }

      return sessions.runLocked(args.sessionId, () => {
        if (mode === "ops") {
          const result = sessions.proposeOps({
            sessionId: args.sessionId,
            ops: (args.ops ?? []) as UiOp[],
            // Progressive default: omit/false → stay streaming; only true finalizes.
            chunkDone: args.chunkDone === true,
            runLint: args.runLint,
            refresh: args.refresh,
            targetNodeId: args.targetNodeId,
          });
          if (!result.ok) {
            return textContent(
              errResult(
                result.code,
                result.message,
                result.lint ? { lint: result.lint } : undefined,
              ),
            );
          }
          return textContent(
            okResult({
              sessionId: result.session.sessionId,
              revision: result.session.revision,
              status: result.session.status,
              partial: result.session.partial,
              warnings: result.warnings,
              lint: result.lint,
              decision: result.decision,
              eventsPath: sessions.events.sessionPath(result.session.sessionId),
              snapshotPath: sessions.events.snapshotPath(result.session.sessionId),
              ...(result.refresh ? { refresh: result.refresh } : {}),
            }),
          );
        }

        if (mode === "streaming_chunks") {
          const result = sessions.proposeChunks({
            sessionId: args.sessionId,
            chunk: args.chunk,
            chunkIndex: args.chunkIndex,
            chunkDone: args.chunkDone,
            runLint: args.runLint,
          });
          if (!result.ok) {
            return textContent(
              errResult(
                result.code,
                result.message,
                "lint" in result && result.lint ? { lint: result.lint } : undefined,
              ),
            );
          }
          return textContent(
            okResult({
              sessionId: result.session.sessionId,
              revision: result.session.revision,
              status: result.session.status,
              warnings: result.warnings,
              lint: result.lint,
              decision: result.decision,
              bufferedChars: "bufferedChars" in result ? result.bufferedChars : 0,
              appliedOps: "appliedOps" in result ? result.appliedOps : 0,
              partial: result.session.partial,
              eventsPath: sessions.events.sessionPath(result.session.sessionId),
              snapshotPath: sessions.events.snapshotPath(result.session.sessionId),
            }),
          );
        }

        const result = sessions.proposeTree({
          sessionId: args.sessionId,
          tree: args.tree as UiNode | undefined,
          plainTextFallback: args.plainTextFallback,
          runLint: args.runLint,
          query: args.query,
          forceUi: args.forceUi,
        });
        if (!result.ok) {
          return textContent(
            errResult(result.code, result.message, result.lint ? { lint: result.lint } : undefined),
          );
        }
        return textContent(
          okResult({
            sessionId: result.session.sessionId,
            revision: result.session.revision,
            status: result.session.status,
            warnings: result.warnings,
            lint: result.lint,
            decision: result.decision,
            plainText: result.plainText,
            ...(policyMeta ? { policy: policyMeta } : {}),
            eventsPath: sessions.events.sessionPath(result.session.sessionId),
            snapshotPath: sessions.events.snapshotPath(result.session.sessionId),
          }),
        );
      });
    },
  );

  server.tool(
    "ui_patch",
    "Apply incremental ops to an existing session tree (idle/action_pending/streaming)",
    {
      sessionId: z.string(),
      ops: z.array(z.record(z.unknown())).min(1),
      statePatch: z.record(z.unknown()).optional(),
      runLint: z.boolean().optional().default(true),
    },
    async (args) => {
      return sessions.runLocked(args.sessionId, () => {
        const result = sessions.patch({
          sessionId: args.sessionId,
          ops: args.ops as UiOp[],
          statePatch: args.statePatch,
          runLint: args.runLint,
        });
        if (!result.ok) {
          return textContent(errResult(result.code, result.message));
        }
        return textContent(
          okResult({
            sessionId: result.session.sessionId,
            revision: result.revision,
            status: result.session.status,
            state: result.state,
            warnings: result.warnings,
            eventsPath: sessions.events.sessionPath(result.session.sessionId),
            snapshotPath: sessions.events.snapshotPath(result.session.sessionId),
          }),
        );
      });
    },
  );

  server.tool(
    "ui_report_action",
    "Report a user interaction; emits ui.action, moves session to action_pending; state.set writes session.state",
    {
      sessionId: z.string(),
      action: z.record(z.unknown()),
      actionId: z.string().optional(),
      applyState: z.boolean().optional().default(true),
    },
    async (args) => {
      return sessions.runLocked(args.sessionId, () => {
        const result = sessions.reportAction({
          sessionId: args.sessionId,
          action: args.action,
          actionId: args.actionId,
          applyState: args.applyState,
          source: "tool",
        });
        if (!result.ok) {
          return textContent(errResult(result.code, result.message));
        }
        return textContent(
          okResult({
            actionId: result.actionId,
            state: result.state,
            status: result.status,
            note: result.note,
            duplicate: result.duplicate,
          }),
        );
      });
    },
  );

  server.tool(
    "ui_drain_actions",
    "Poll Host actions.ndjson + return pending actions for harness (marks drained by default)",
    {
      sessionId: z.string(),
      markDrained: z.boolean().optional().default(true),
      max: z.number().int().optional().default(100),
    },
    async ({ sessionId, markDrained, max }) => {
      const result = sessions.drainActions(sessionId, { markDrained, max });
      if (!result.ok) {
        return textContent(errResult(result.code, result.message));
      }
      return textContent(
        okResult({
          actions: result.actions,
          status: result.status,
          lastActionId: result.lastActionId,
          count: result.actions.length,
        }),
      );
    },
  );

  server.tool(
    "ui_get_pending_actions",
    "Peek pending actions without marking drained (also polls actions.ndjson)",
    {
      sessionId: z.string(),
    },
    async ({ sessionId }) => {
      const result = sessions.getPendingActions(sessionId);
      if (!result.ok) {
        return textContent(errResult(result.code, result.message));
      }
      return textContent(
        okResult({
          actions: result.actions,
          status: result.status,
          lastActionId: result.lastActionId,
          count: result.actions.length,
        }),
      );
    },
  );

  server.tool(
    "ui_get_state",
    "Read session status, revision, tree, and state",
    {
      sessionId: z.string(),
      includeTree: z.boolean().optional().default(true),
      includeState: z.boolean().optional().default(true),
    },
    async ({ sessionId, includeTree, includeState }) => {
      const result = sessions.getState(sessionId, { includeTree, includeState });
      if (!result.ok) {
        return textContent(errResult(result.code, result.message));
      }
      return textContent(okResult(result));
    },
  );

  server.tool(
    "ui_close",
    "Close a UI session",
    {
      sessionId: z.string(),
      reason: z
        .enum(["completed", "cancelled", "error", "replaced"])
        .optional()
        .default("completed"),
    },
    async ({ sessionId, reason }) => {
      return sessions.runLocked(sessionId, () => {
        const result = sessions.close(sessionId, reason);
        if (!result.ok) {
          return textContent(errResult(result.code, result.message));
        }
        return textContent(okResult({}));
      });
    },
  );

  server.tool(
    "register_package",
    "Register a local custom package from a trusted path (manifest.json + renderer entry). strictHash defaults true (IUI_STRICT_HASH / omit); pass strictHash:false only to skip. Never evals model JS; no npm/url.",
    {
      path: z.string(),
      enable: z.boolean().optional().default(true),
      // default true — also enforced in registerPackageFromPath via IUI_STRICT_HASH
      strictHash: z.boolean().optional(),
    },
    async ({ path: pkgPath, enable, strictHash }) => {
      const result = registerPackageFromPath(catalog, hostRegistry, {
        path: pkgPath,
        enable,
        strictHash,
      });
      if (!result.ok) {
        return textContent(errResult(result.code, result.message));
      }
      return textContent(
        okResult({
          packageId: result.packageId,
          renderStatus: result.renderStatus,
          warnings: result.warnings,
          components: result.components,
          registryPath: hostRegistry.registryPath(),
        }),
      );
    },
  );

  server.tool(
    "register_component",
    "Hot-update schema for a component on an already-registered local package (does not swap entry).",
    {
      packageId: z.string(),
      name: z.string(),
      propsSchema: z.record(z.unknown()),
      description: z.string().optional(),
      actions: z.array(z.string()).optional(),
      rendererExport: z.string().optional(),
      enable: z.boolean().optional().default(true),
    },
    async (args) => {
      const result = registerComponentHot(catalog, hostRegistry, args);
      if (!result.ok) {
        return textContent(errResult(result.code, result.message));
      }
      return textContent(okResult({ type: result.type }));
    },
  );

  server.tool(
    "unregister",
    "Unregister a local package or component. Builtin catalog.* cannot be unregistered.",
    {
      packageId: z.string().optional(),
      componentType: z.string().optional(),
    },
    async ({ packageId, componentType }) => {
      const result = unregisterPackageOrComponent(catalog, hostRegistry, {
        packageId,
        componentType,
      });
      if (!result.ok) {
        return textContent(errResult(result.code, result.message));
      }
      return textContent(okResult({}));
    },
  );

  server.tool(
    "policy_check",
    "Design-judgment referee: plain_text vs ui. Default OFF (IUI_POLICY_ENABLED≠1). Uses IUI_POLICY_ENDPOINT and/or IUI_POLICY_CMD; fails soft to Phase A heuristic.",
    {
      query: z.string(),
      treeSummary: z.string().optional(),
      plainTextAlternative: z.string().optional(),
      proposedTypes: z.array(z.string()).optional(),
    },
    async (args) => {
      const result = await policyCheck(args);
      return textContent(
        okResult({
          decision: result.decision,
          score: result.score,
          reasons: result.reasons,
          suggested_types: result.suggested_types,
          source: result.source,
          enabled: result.enabled,
          note: result.enabled
            ? "Policy enabled — treat decision as soft gate for ui_propose"
            : "Policy disabled — heuristic returned for inspection only; ui_propose will not gate",
        }),
      );
    },
  );

  server.tool(
    "evaluate_expr",
    "Evaluate a safe G6 expression against a state object (whitelist: + - * / (), round/min/max/abs). Rejects arbitrary JS.",
    {
      expr: z.string(),
      state: z.record(z.unknown()).optional().default({}),
    },
    async ({ expr, state }) => {
      const r = evaluateExpr(expr, state ?? {});
      if (!r.ok) {
        return textContent(errResult(r.code, r.message));
      }
      return textContent(okResult({ value: r.value }));
    },
  );

  return { server, catalog, sessions, hostRegistry };
}

