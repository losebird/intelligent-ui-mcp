import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { prefersReducedMotion } from "./prefersReducedMotion.js";

export type NodeMotionShellProps = {
  nodeId: string;
  type?: string;
  className?: string;
  /** When false, skip enter animation (still stable wrapper). */
  motion?: boolean;
  /** Stagger index among siblings for subtle delay (capped). */
  enterIndex?: number;
  children: ReactNode;
};

const ENTER_MS = 240;
const STAGGER_MS = 28;
const STAGGER_CAP = 8;

/**
 * Stable shell keyed by nodeId outside (caller). First mount → fade/slide enter;
 * subsequent props updates keep the same DOM node (no remount).
 */
export function NodeMotionShell(props: NodeMotionShellProps) {
  const { nodeId, type, className, motion = true, enterIndex = 0, children } =
    props;
  const ref = useRef<HTMLDivElement>(null);
  const playedRef = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || playedRef.current) return;

    if (!motion || prefersReducedMotion()) {
      el.dataset.iuiMotion = "skipped";
      playedRef.current = true;
      return;
    }

    const delay = Math.min(Math.max(enterIndex, 0), STAGGER_CAP) * STAGGER_MS;
    el.style.setProperty("--iui-enter-delay", `${delay}ms`);
    el.dataset.iuiMotion = "enter";

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      el.dataset.iuiMotion = "done";
      playedRef.current = true;
      el.removeEventListener("animationend", onEnd);
    };
    const onEnd = (ev: AnimationEvent) => {
      if (ev.target !== el) return;
      if (ev.animationName && !String(ev.animationName).includes("iui-node-enter")) {
        return;
      }
      finish();
    };
    el.addEventListener("animationend", onEnd);
    const t = window.setTimeout(finish, ENTER_MS + delay + 80);
    return () => {
      window.clearTimeout(t);
      el.removeEventListener("animationend", onEnd);
    };
  }, [motion, enterIndex]);

  const style: CSSProperties | undefined =
    motion && !prefersReducedMotion()
      ? ({ ["--iui-enter-delay" as string]: "0ms" } as CSSProperties)
      : undefined;

  return (
    <div
      ref={ref}
      data-iui-node-id={nodeId}
      data-iui-type={type}
      data-iui-motion={playedRef.current ? "done" : motion ? "pending" : "off"}
      className={["iui-node-shell", className].filter(Boolean).join(" ")}
      style={style}
    >
      {children}
    </div>
  );
}
