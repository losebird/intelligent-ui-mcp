import type { ReactNode } from "react";

export type SkeletonPlaceholderProps = {
  /** Number of shimmer rows */
  rows?: number;
  className?: string;
  label?: string;
  /** Compact single-line bar (inline under streaming tree) */
  variant?: "block" | "inline";
};

/**
 * Loading shimmer while ops stream before/while nodes arrive.
 * Pure presentational — does not remount existing tree nodes.
 */
export function SkeletonPlaceholder(props: SkeletonPlaceholderProps) {
  const rows = Math.min(Math.max(props.rows ?? 3, 1), 8);
  const variant = props.variant ?? "block";
  const label = props.label ?? "生成中…";

  if (variant === "inline") {
    return (
      <div
        className={["iui-skeleton", "iui-skeleton-inline", props.className]
          .filter(Boolean)
          .join(" ")}
        role="status"
        aria-live="polite"
        aria-label={label}
        data-iui-skeleton="inline"
      >
        <span className="iui-skeleton-bar iui-skeleton-bar-sm" />
        <span className="iui-skeleton-bar iui-skeleton-bar-md" />
      </div>
    );
  }

  const lines: ReactNode[] = [];
  for (let i = 0; i < rows; i++) {
    const width =
      i === 0 ? "72%" : i === rows - 1 ? "48%" : i % 2 === 0 ? "88%" : "64%";
    lines.push(
      <div
        key={`sk_${i}`}
        className="iui-skeleton-row"
        style={{ width }}
        data-iui-skeleton-row={i}
      >
        <span className="iui-skeleton-bar" />
      </div>,
    );
  }

  return (
    <div
      className={["iui-skeleton", "iui-skeleton-block", props.className]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live="polite"
      aria-label={label}
      data-iui-skeleton="block"
    >
      <div className="iui-skeleton-label">{label}</div>
      {lines}
    </div>
  );
}
