/**
 * acme.gauges — example custom package renderer (ESM).
 * Prefer `import React from "react"` — Host sandbox provides React via import map.
 * Also works with globalThis.React if present.
 */
import React from "react";

const { useMemo } = React;

/**
 * @param {{ value: number, max?: number, label?: string, onAction?: Function, nodeId?: string }} props
 */
export function Gauge({ value, max = 100, label, onAction, nodeId }) {
  const safeMax = typeof max === "number" && max > 0 ? max : 100;
  const safeValue = typeof value === "number" ? value : 0;
  const pct = Math.max(0, Math.min(1, safeValue / safeMax));
  const angle = pct * 180;

  const arc = useMemo(() => {
    const r = 42;
    const cx = 50;
    const cy = 50;
    const start = { x: cx - r, y: cy };
    const rad = ((180 - angle) * Math.PI) / 180;
    const end = { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
    const large = angle > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
  }, [angle]);

  return React.createElement(
    "div",
    {
      "data-acme-gauge": nodeId || "",
      style: {
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: 8,
        minWidth: 120,
        fontFamily: "system-ui, sans-serif",
        color: "#0f172a",
      },
    },
    label
      ? React.createElement(
          "div",
          { style: { fontSize: 12, fontWeight: 600, color: "#334155" } },
          label,
        )
      : null,
    React.createElement(
      "svg",
      { width: 120, height: 70, viewBox: "0 0 100 60", "aria-label": label || "gauge" },
      React.createElement("path", {
        d: "M 8 50 A 42 42 0 0 1 92 50",
        fill: "none",
        stroke: "#e2e8f0",
        strokeWidth: 10,
        strokeLinecap: "round",
      }),
      React.createElement("path", {
        d: arc,
        fill: "none",
        stroke: "#2563eb",
        strokeWidth: 10,
        strokeLinecap: "round",
      }),
      React.createElement(
        "text",
        {
          x: 50,
          y: 48,
          textAnchor: "middle",
          fontSize: 14,
          fontWeight: 700,
          fill: "#0f172a",
        },
        String(Math.round(safeValue)),
      ),
    ),
    React.createElement(
      "button",
      {
        type: "button",
        style: {
          fontSize: 11,
          padding: "2px 8px",
          borderRadius: 6,
          border: "1px solid #cbd5e1",
          background: "#f8fafc",
          cursor: "pointer",
        },
        onClick: () =>
          onAction?.({
            type: "change",
            value: Math.min(safeMax, safeValue + 5),
            payload: { delta: 5 },
          }),
      },
      "+5",
    ),
  );
}

export default { Gauge };
