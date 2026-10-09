/**
 * Lightweight Motion helpers — NOT Claude Artifacts Motion / Dashboards.
 * Respect prefers-reduced-motion; never remount nodes for animation.
 */

let cached: boolean | null = null;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  if (cached !== null) return cached;
  try {
    cached = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    cached = false;
  }
  return cached;
}

/** Test-only: clear cache between cases. */
export function resetPrefersReducedMotionCache(): void {
  cached = null;
}

/** Subscribe to changes (Host chrome can flip data-iui-reduced-motion). */
export function subscribePrefersReducedMotion(
  onChange: (reduced: boolean) => void,
): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const handler = () => {
    cached = mq.matches;
    onChange(mq.matches);
  };
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }
  // Safari < 14
  mq.addListener(handler);
  return () => mq.removeListener(handler);
}
