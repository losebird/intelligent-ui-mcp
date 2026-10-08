import type { ComponentRenderer } from "../../types.js";

type Point = Record<string, unknown>;

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickXY(
  row: Point,
  xKey: string,
  yKey: string,
): { label: string; value: number } {
  const label = row[xKey] ?? row.label ?? row.x ?? row.name ?? "";
  const value = num(row[yKey] ?? row.value ?? row.y, 0);
  return { label: String(label), value };
}

function normalizeSeries(
  data: unknown,
  xKey: string,
  yKey: string,
): Array<{ label: string; value: number }> {
  if (!Array.isArray(data)) return [];
  return data.map((row) => pickXY((row ?? {}) as Point, xKey, yKey));
}

const PIE_COLORS = [
  "#2563eb",
  "#0f766e",
  "#c2410c",
  "#7c3aed",
  "#db2777",
  "#ca8a04",
  "#0891b2",
  "#4b5563",
];

export const chartsRenderers: Record<string, ComponentRenderer> = {
  "catalog.charts/LineChart": ({ node }) => {
    const xKey = String(node.props?.xKey ?? "label");
    const yKey = String(node.props?.yKey ?? "value");
    const series = normalizeSeries(node.props?.data, xKey, yKey);
    const height = num(node.props?.height, 200);
    const color = String(node.props?.color ?? "#2563eb");
    const showDots = node.props?.showDots !== false;
    const title = node.props?.title ? String(node.props.title) : undefined;
    const aria = String(node.props?.ariaLabel ?? title ?? "Line chart");
    const pad = 32;
    const width = 420;
    const values = series.map((s) => s.value);
    const minV = values.length ? Math.min(0, ...values) : 0;
    const maxV = values.length ? Math.max(...values, 1) : 1;
    const span = maxV - minV || 1;
    const coords = series.map((s, i) => {
      const x =
        pad +
        (series.length <= 1
          ? (width - pad * 2) / 2
          : (i / (series.length - 1)) * (width - pad * 2));
      const y = pad + (1 - (s.value - minV) / span) * (height - pad * 2);
      return { x, y, ...s };
    });
    const d = coords
      .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(" ");
    const baseline = height - pad;
    const areaD =
      coords.length > 0
        ? `${d} L${coords[coords.length - 1]!.x.toFixed(1)},${baseline} L${coords[0]!.x.toFixed(1)},${baseline} Z`
        : "";
    const gradId = `iui-line-grad-${String(node.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const gridYs = [0.25, 0.5, 0.75].map((t) => pad + t * (height - pad * 2));
    return (
      <figure className="iui-chart" data-iui-id={node.id}>
        {title ? <figcaption className="iui-chart-title">{title}</figcaption> : null}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={aria}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {gridYs.map((y, i) => (
            <line
              key={i}
              x1={pad}
              y1={y}
              x2={width - pad}
              y2={y}
              className="iui-chart-grid"
            />
          ))}
          <line
            x1={pad}
            y1={height - pad}
            x2={width - pad}
            y2={height - pad}
            className="iui-chart-axis"
          />
          <line
            x1={pad}
            y1={pad}
            x2={pad}
            y2={height - pad}
            className="iui-chart-axis"
          />
          {areaD ? (
            <path d={areaD} fill={`url(#${gradId})`} className="iui-chart-area" />
          ) : null}
          {d ? <path d={d} stroke={color} className="iui-chart-line" /> : null}
          {showDots
            ? coords.map((c, i) => (
                <g key={i}>
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={4}
                    fill={color}
                    className="iui-chart-dot"
                  >
                    <title>{`${c.label}: ${c.value}`}</title>
                  </circle>
                  <text
                    x={c.x}
                    y={height - pad + 16}
                    textAnchor="middle"
                    className="iui-chart-tick"
                  >
                    {c.label}
                  </text>
                </g>
              ))
            : null}
        </svg>
        <div className="iui-chart-legend">
          {series.map((s, i) => (
            <span key={i}>
              <span className="iui-chart-swatch" style={{ background: color }} />
              {s.label}: {s.value}
            </span>
          ))}
        </div>
      </figure>
    );
  },

  "catalog.charts/BarChart": ({ node }) => {
    const xKey = String(node.props?.xKey ?? "label");
    const yKey = String(node.props?.yKey ?? "value");
    const series = normalizeSeries(node.props?.data, xKey, yKey);
    const height = num(node.props?.height, 200);
    const color = String(node.props?.color ?? "#0f766e");
    const title = node.props?.title ? String(node.props.title) : undefined;
    const aria = String(node.props?.ariaLabel ?? title ?? "Bar chart");
    const pad = 32;
    const width = 420;
    const maxV = Math.max(...series.map((s) => s.value), 1);
    const gap = 10;
    const inner = width - pad * 2;
    const barW =
      series.length > 0
        ? Math.max(10, (inner - gap * (series.length - 1)) / series.length)
        : 0;
    const gridYs = [0.25, 0.5, 0.75].map((t) => pad + t * (height - pad * 2));
    return (
      <figure className="iui-chart" data-iui-id={node.id}>
        {title ? <figcaption className="iui-chart-title">{title}</figcaption> : null}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={aria}
        >
          {gridYs.map((y, i) => (
            <line
              key={i}
              x1={pad}
              y1={y}
              x2={width - pad}
              y2={y}
              className="iui-chart-grid"
            />
          ))}
          <line
            x1={pad}
            y1={height - pad}
            x2={width - pad}
            y2={height - pad}
            className="iui-chart-axis"
          />
          {series.map((s, i) => {
            const h = (s.value / maxV) * (height - pad * 2) || 0;
            const x = pad + i * (barW + gap);
            const y = height - pad - h;
            return (
              <g key={i}>
                <rect x={x} y={y} width={barW} height={h} fill={color} rx={5}>
                  <title>{`${s.label}: ${s.value}`}</title>
                </rect>
                <text
                  x={x + barW / 2}
                  y={height - pad + 16}
                  textAnchor="middle"
                  className="iui-chart-tick"
                >
                  {s.label}
                </text>
              </g>
            );
          })}
        </svg>
      </figure>
    );
  },

  "catalog.charts/PieChart": ({ node }) => {
    const raw = Array.isArray(node.props?.data) ? (node.props!.data as Point[]) : [];
    const series = raw.map((row) => ({
      label: String(row.label ?? ""),
      value: Math.max(0, num(row.value, 0)),
    }));
    const size = num(node.props?.size, 168);
    const donut = Boolean(node.props?.donut);
    const title = node.props?.title ? String(node.props.title) : undefined;
    const aria = String(node.props?.ariaLabel ?? title ?? "Pie chart");
    const total = series.reduce((a, s) => a + s.value, 0) || 1;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 4;
    const innerR = donut ? r * 0.55 : 0;
    let angle = -Math.PI / 2;
    const slices = series.map((s, i) => {
      const sweep = (s.value / total) * Math.PI * 2;
      const a0 = angle;
      const a1 = angle + sweep;
      angle = a1;
      const x0 = cx + r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      const large = sweep > Math.PI ? 1 : 0;
      let d: string;
      if (donut) {
        const ix0 = cx + innerR * Math.cos(a1);
        const iy0 = cy + innerR * Math.sin(a1);
        const ix1 = cx + innerR * Math.cos(a0);
        const iy1 = cy + innerR * Math.sin(a0);
        d = [
          `M ${x0} ${y0}`,
          `A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`,
          `L ${ix0} ${iy0}`,
          `A ${innerR} ${innerR} 0 ${large} 0 ${ix1} ${iy1}`,
          "Z",
        ].join(" ");
      } else {
        d = [
          `M ${cx} ${cy}`,
          `L ${x0} ${y0}`,
          `A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`,
          "Z",
        ].join(" ");
      }
      return { ...s, d, color: PIE_COLORS[i % PIE_COLORS.length] };
    });
    return (
      <figure className="iui-chart iui-chart-pie" data-iui-id={node.id}>
        {title ? <figcaption className="iui-chart-title">{title}</figcaption> : null}
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          role="img"
          aria-label={aria}
        >
          {slices.map((s, i) => (
            <path key={i} d={s.d} fill={s.color} stroke="#fff" strokeWidth={1.5}>
              <title>{`${s.label}: ${s.value}`}</title>
            </path>
          ))}
        </svg>
        <ul className="iui-chart-legend">
          {slices.map((s, i) => (
            <li key={i}>
              <span className="iui-chart-swatch" style={{ background: s.color }} />
              {s.label}: {s.value}
            </li>
          ))}
        </ul>
      </figure>
    );
  },
};
