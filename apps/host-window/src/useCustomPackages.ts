import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type { ComponentRenderer, RenderAction } from "@intelligent-ui/renderer-react";
import { fetchPackageEntry, fetchPackages, type HostPackageRecord } from "./api";
import { SandboxedCustomSlot } from "./sandbox/SandboxedCustomSlot";

export interface CustomPackageStatus {
  id: string;
  status: "loading" | "ready" | "failed" | "partial";
  message?: string;
  missingExports?: string[];
  sandboxed?: boolean;
}

/**
 * Custom (non-builtin) packages load ONLY inside opaque-origin iframes.
 * Builtin catalog.* renderers stay in-process via renderer-react.
 *
 * Escape hatch (insecure): IUI_CUSTOM_PACKAGE_MAIN_WORLD=1 restores legacy
 * Vite /@fs dynamic import into the Host page — documented as unsafe.
 */
function mainWorldAllowed(): boolean {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
    const v = env?.IUI_CUSTOM_PACKAGE_MAIN_WORLD ?? "";
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

function toFsUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  return `/@fs${normalized}`;
}

function wrapSandboxed(
  moduleSource: string,
  exportName: string,
  type: string,
): ComponentRenderer {
  return ({ node, ctx }) => {
    const onAction = (action: RenderAction) => {
      ctx.onAction?.(action);
    };
    return createElement(SandboxedCustomSlot, {
      moduleSource,
      exportName,
      componentType: type,
      nodeId: node.id,
      props: (node.props ?? {}) as Record<string, unknown>,
      onAction,
    }) as ReactNode;
  };
}

function wrapMainWorldExport(
  Comp: unknown,
  type: string,
): ComponentRenderer {
  return ({ node, ctx }) => {
    const onAction = (a: {
      type?: string;
      value?: unknown;
      payload?: Record<string, unknown>;
    }) => {
      const action: RenderAction = {
        type: a?.type ?? "change",
        nodeId: node.id,
        componentType: type,
        value: a?.value,
        payload: a?.payload ?? {},
      };
      ctx.onAction?.(action);
    };
    const CompType = Comp as ComponentType<Record<string, unknown>>;
    return createElement(CompType, {
      ...(node.props ?? {}),
      nodeId: node.id,
      onAction,
    });
  };
}

export function useCustomPackages() {
  const [extraRenderers, setExtraRenderers] = useState<Record<string, ComponentRenderer>>(
    {},
  );
  const [statuses, setStatuses] = useState<CustomPackageStatus[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const loadedRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const allowMain = mainWorldAllowed();

    const tick = async () => {
      try {
        const res = await fetchPackages();
        if (cancelled) return;
        const pkgs = (res.packages ?? []).filter((p) => p.enabled !== false);
        const key = JSON.stringify(
          pkgs.map((p) => [p.id, p.version, p.entryAbsPath, p.hash, p.components, allowMain]),
        );
        if (key === loadedRef.current) {
          timer = setTimeout(tick, 500);
          return;
        }
        loadedRef.current = key;

        const nextRenderers: Record<string, ComponentRenderer> = {};
        const nextStatuses: CustomPackageStatus[] = [];
        const failMsgs: string[] = [];

        for (const pkg of pkgs) {
          const st = allowMain
            ? await loadOneMainWorld(pkg, nextRenderers)
            : await loadOneSandboxed(pkg, nextRenderers);
          nextStatuses.push(st);
          if (st.status === "failed") {
            failMsgs.push(`${pkg.id}: ${st.message ?? "load failed"}`);
          } else if (st.status === "partial" && st.missingExports?.length) {
            failMsgs.push(
              `${pkg.id}: missing exports ${st.missingExports.join(", ")} → Unknown`,
            );
          }
        }

        if (!cancelled) {
          setExtraRenderers(nextRenderers);
          setStatuses(nextStatuses);
          const prefix = allowMain
            ? "⚠ MAIN_WORLD (insecure): "
            : "";
          setBanner(
            failMsgs.length
              ? prefix + failMsgs.join("；")
              : allowMain
                ? "⚠ IUI_CUSTOM_PACKAGE_MAIN_WORLD=1 — custom packages run in Host page (no iframe)"
                : null,
          );
        }
      } catch {
        if (!cancelled) {
          setBanner(null);
        }
      } finally {
        if (!cancelled) timer = setTimeout(tick, 500);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { extraRenderers, statuses, banner };
}

async function loadOneSandboxed(
  pkg: HostPackageRecord,
  into: Record<string, ComponentRenderer>,
): Promise<CustomPackageStatus> {
  if (!pkg.entryAbsPath && !pkg.id) {
    return { id: pkg.id, status: "failed", message: "no package id", sandboxed: true };
  }
  try {
    const entry = await fetchPackageEntry(pkg.id);
    if (!entry.ok || typeof entry.source !== "string") {
      return {
        id: pkg.id,
        status: "failed",
        message: entry.error ?? "package-entry failed",
        sandboxed: true,
      };
    }
    const exportsMap = pkg.exports ?? {};
    const names = pkg.components?.length ? pkg.components : Object.keys(exportsMap);
    const missing: string[] = [];

    for (const name of names) {
      const exportName = exportsMap[name] ?? name;
      const type = `${pkg.id}/${name}`;
      // We cannot introspect ESM exports without executing; register all declared names.
      // Missing export surfaces as sandbox error → Unknown-like banner via status partial later.
      into[type] = wrapSandboxed(entry.source, exportName, type);
    }

    if (!names.length) {
      return {
        id: pkg.id,
        status: "failed",
        message: "no components in registry",
        sandboxed: true,
        missingExports: missing,
      };
    }
    return { id: pkg.id, status: "ready", sandboxed: true };
  } catch (e) {
    return {
      id: pkg.id,
      status: "failed",
      message: e instanceof Error ? e.message : String(e),
      sandboxed: true,
    };
  }
}

/** Legacy insecure path — only when IUI_CUSTOM_PACKAGE_MAIN_WORLD=1. */
async function loadOneMainWorld(
  pkg: HostPackageRecord,
  into: Record<string, ComponentRenderer>,
): Promise<CustomPackageStatus> {
  if (!pkg.entryAbsPath) {
    return { id: pkg.id, status: "failed", message: "no entryAbsPath", sandboxed: false };
  }
  try {
    const url = toFsUrl(pkg.entryAbsPath);
    const mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown> & {
      default?: Record<string, unknown>;
    };
    const missing: string[] = [];
    const exportsMap = pkg.exports ?? {};
    const names = pkg.components?.length ? pkg.components : Object.keys(exportsMap);

    for (const name of names) {
      const exportName = exportsMap[name] ?? name;
      const Comp =
        (mod[exportName] as unknown) ??
        (mod.default?.[exportName] as unknown);
      const type = `${pkg.id}/${name}`;
      if (!Comp || (typeof Comp !== "function" && typeof Comp !== "object")) {
        missing.push(exportName);
        continue;
      }
      into[type] = wrapMainWorldExport(Comp, type);
    }

    if (missing.length && missing.length === names.length) {
      return {
        id: pkg.id,
        status: "failed",
        message: `no usable exports (${missing.join(", ")})`,
        missingExports: missing,
        sandboxed: false,
      };
    }
    if (missing.length) {
      return { id: pkg.id, status: "partial", missingExports: missing, sandboxed: false };
    }
    return { id: pkg.id, status: "ready", sandboxed: false };
  } catch (e) {
    return {
      id: pkg.id,
      status: "failed",
      message: e instanceof Error ? e.message : String(e),
      sandboxed: false,
    };
  }
}
