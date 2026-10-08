import { createElement, useEffect, useRef, useState, type ComponentType } from "react";
import type { ComponentRenderer, RenderAction } from "@intelligent-ui/renderer-react";
import { fetchPackages, type HostPackageRecord } from "./api";

export interface CustomPackageStatus {
  id: string;
  status: "loading" | "ready" | "failed" | "partial";
  message?: string;
  missingExports?: string[];
}

function toFsUrl(absPath: string): string {
  // Vite absolute filesystem import
  const normalized = absPath.replace(/\\/g, "/");
  return `/@fs${normalized}`;
}

function wrapExport(
  Comp: ComponentType<Record<string, unknown>>,
  type: string,
): ComponentRenderer {
  return ({ node, ctx }) => {
    const onAction = (a: { type?: string; value?: unknown; payload?: Record<string, unknown> }) => {
      const action: RenderAction = {
        type: a?.type ?? "change",
        nodeId: node.id,
        componentType: type,
        value: a?.value,
        payload: a?.payload ?? {},
      };
      ctx.onAction?.(action);
    };
    return createElement(Comp, {
      ...(node.props ?? {}),
      nodeId: node.id,
      onAction,
    });
  };
}

export function useCustomPackages() {
  const [extraRenderers, setExtraRenderers] = useState<Record<string, ComponentRenderer>>({});
  const [statuses, setStatuses] = useState<CustomPackageStatus[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const loadedRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const res = await fetchPackages();
        if (cancelled) return;
        const pkgs = (res.packages ?? []).filter((p) => p.enabled !== false);
        const key = JSON.stringify(
          pkgs.map((p) => [p.id, p.version, p.entryAbsPath, p.hash, p.components]),
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
          const st = await loadOne(pkg, nextRenderers);
          nextStatuses.push(st);
          if (st.status === "failed") {
            failMsgs.push(`${pkg.id}: ${st.message ?? "import failed"}`);
          } else if (st.status === "partial" && st.missingExports?.length) {
            failMsgs.push(
              `${pkg.id}: missing exports ${st.missingExports.join(", ")} → Unknown`,
            );
          }
        }

        if (!cancelled) {
          setExtraRenderers(nextRenderers);
          setStatuses(nextStatuses);
          setBanner(failMsgs.length ? failMsgs.join("；") : null);
        }
      } catch (e) {
        if (!cancelled) {
          // registry may not exist yet — quiet
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

async function loadOne(
  pkg: HostPackageRecord,
  into: Record<string, ComponentRenderer>,
): Promise<CustomPackageStatus> {
  if (!pkg.entryAbsPath) {
    return { id: pkg.id, status: "failed", message: "no entryAbsPath" };
  }
  try {
    const url = toFsUrl(pkg.entryAbsPath);
    const mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown> & {
      default?: Record<string, unknown>;
    };
    const missing: string[] = [];
    const exportsMap = pkg.exports ?? {};
    const names = pkg.components?.length
      ? pkg.components
      : Object.keys(exportsMap);

    for (const name of names) {
      const exportName = exportsMap[name] ?? name;
      const Comp =
        (mod[exportName] as ComponentType<Record<string, unknown>> | undefined) ??
        (mod.default?.[exportName] as ComponentType<Record<string, unknown>> | undefined);
      const type = `${pkg.id}/${name}`;
      if (!Comp || (typeof Comp !== "function" && typeof Comp !== "object")) {
        missing.push(exportName);
        continue;
      }
      into[type] = wrapExport(Comp, type);
    }

    if (missing.length && missing.length === names.length) {
      return {
        id: pkg.id,
        status: "failed",
        message: `no usable exports (${missing.join(", ")})`,
        missingExports: missing,
      };
    }
    if (missing.length) {
      return { id: pkg.id, status: "partial", missingExports: missing };
    }
    return { id: pkg.id, status: "ready" };
  } catch (e) {
    return {
      id: pkg.id,
      status: "failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
