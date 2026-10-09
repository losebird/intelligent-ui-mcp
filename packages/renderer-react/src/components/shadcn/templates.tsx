import { useEffect, useMemo, useState } from "react";
import type { ComponentRenderer, RenderAction, UiNode } from "../../types.js";

function emit(
  ctx: { onAction?: (a: RenderAction) => void },
  node: UiNode,
  type: string,
  extra: Partial<RenderAction> = {},
) {
  ctx.onAction?.({
    type,
    nodeId: node.id,
    componentType: node.type,
    ...extra,
  });
}

/** Tiny arithmetic evaluator (digits + + - * / % ( ) only). No Function/eval. */
function safeEval(expr: string): string {
  const cleaned = expr.replace(/\s+/g, "");
  if (!cleaned) return "";
  if (!/^[0-9.+\-*/()%]+$/.test(cleaned)) return "Error";
  let i = 0;
  const peek = () => cleaned[i];
  const consume = () => cleaned[i++];
  function parseExpr(): number {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = consume();
      const r = parseFactor();
      if (op === "*") v *= r;
      else if (op === "/") v /= r;
      else v %= r;
    }
    return v;
  }
  function parseFactor(): number {
    if (peek() === "+") {
      consume();
      return parseFactor();
    }
    if (peek() === "-") {
      consume();
      return -parseFactor();
    }
    if (peek() === "(") {
      consume();
      const v = parseExpr();
      if (peek() !== ")") throw new Error("paren");
      consume();
      return v;
    }
    const start = i;
    while (peek() && /[0-9.]/.test(peek())) consume();
    if (start === i) throw new Error("num");
    const n = Number(cleaned.slice(start, i));
    if (!Number.isFinite(n)) throw new Error("nan");
    return n;
  }
  try {
    const v = parseExpr();
    if (i !== cleaned.length) return "Error";
    if (!Number.isFinite(v)) return "Error";
    return String(Math.round(v * 1e10) / 1e10);
  } catch {
    return "Error";
  }
}

function calcWinner(board: Array<string | null>): string | null {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as string;
    }
  }
  if (board.every((c) => c)) return "draw";
  return null;
}

export const templateRenderers: Record<string, ComponentRenderer> = {
  "catalog.shadcn/Calculator": ({ node, ctx }) => {
    const [display, setDisplay] = useState(String(node.props?.expression ?? "0"));
    const [result, setResult] = useState(String(node.props?.result ?? ""));
    // Data-tool patches (ui_patch patch_props) must update screen without remount.
    useEffect(() => {
      if (node.props?.expression != null) setDisplay(String(node.props.expression));
      if (node.props?.result != null) setResult(String(node.props.result));
    }, [node.props?.expression, node.props?.result]);
    const keys = [
      ["C", "±", "%", "÷"],
      ["7", "8", "9", "×"],
      ["4", "5", "6", "−"],
      ["1", "2", "3", "+"],
      ["0", ".", "="],
    ];

    const press = (key: string) => {
      if (key === "C") {
        setDisplay("0");
        setResult("");
        emit(ctx, node, "clear", { payload: { key } });
        return;
      }
      if (key === "=") {
        const expr = display
          .replace(/×/g, "*")
          .replace(/÷/g, "/")
          .replace(/−/g, "-");
        const r = safeEval(expr);
        setResult(r);
        emit(ctx, node, "equals", { value: r, payload: { expression: display, result: r } });
        if (r !== "Error") setDisplay(r);
        return;
      }
      if (key === "±") {
        if (display.startsWith("-")) setDisplay(display.slice(1) || "0");
        else if (display !== "0") setDisplay("-" + display);
        emit(ctx, node, "press", { payload: { key } });
        return;
      }
      const map: Record<string, string> = { "×": "×", "÷": "÷", "−": "−", "+": "+", "%": "%" };
      let next = display;
      if (display === "0" && /[0-9]/.test(key)) next = key;
      else if (display === "0" && key === ".") next = "0.";
      else next = display + (map[key] ?? key);
      setDisplay(next);
      emit(ctx, node, "press", { payload: { key, display: next } });
    };

    return (
      <div className="iui-calc" data-iui-id={node.id}>
        {node.props?.title ? (
          <div className="iui-calc-title">{String(node.props.title)}</div>
        ) : null}
        <div className="iui-calc-screen">
          <div className="iui-calc-expr">{display}</div>
          {result ? <div className="iui-calc-result">{result}</div> : null}
        </div>
        <div className="iui-calc-pad">
          {keys.map((row, ri) => (
            <div key={ri} className="iui-calc-row">
              {row.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`iui-calc-key${k === "0" ? " iui-calc-key-wide" : ""}${
                    ["÷", "×", "−", "+", "="].includes(k) ? " iui-calc-key-op" : ""
                  }${k === "C" ? " iui-calc-key-fn" : ""}`}
                  onClick={() => press(k)}
                >
                  {k}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  },

  "catalog.shadcn/Comparison": ({ node, ctx }) => {
    const layout = (node.props?.layout as string) ?? "cards";
    const aspects =
      (node.props?.aspects as Array<{ id: string; label: string }>) ?? [];
    const items =
      (node.props?.items as Array<{
        id: string;
        name: string;
        subtitle?: string;
        badge?: string;
        highlight?: boolean;
        values?: Record<string, string | number | boolean | null>;
      }>) ?? [];
    const [selected, setSelected] = useState(String(node.props?.selectedId ?? ""));
    const selectLabel = String(node.props?.selectLabel ?? "选这个");

    const aspectIds = useMemo(() => {
      if (aspects.length) return aspects;
      const keys = new Set<string>();
      for (const it of items) {
        for (const k of Object.keys(it.values ?? {})) keys.add(k);
      }
      return [...keys].map((id) => ({ id, label: id }));
    }, [aspects, items]);

    if (layout === "table") {
      return (
        <div className="iui-compare" data-iui-id={node.id}>
          {node.props?.title ? (
            <div className="iui-compare-title">{String(node.props.title)}</div>
          ) : null}
          <div className="iui-table-wrap">
            <table className="iui-table iui-compare-table">
              <thead>
                <tr>
                  <th>规格</th>
                  {items.map((it) => (
                    <th key={it.id} className={it.id === selected || it.highlight ? "iui-compare-hot" : ""}>
                      {it.name}
                      {it.badge ? <span className="iui-badge iui-badge-default">{it.badge}</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {aspectIds.map((a) => (
                  <tr key={a.id}>
                    <td>{a.label}</td>
                    {items.map((it) => (
                      <td key={it.id}>{it.values?.[a.id] == null ? "—" : String(it.values[a.id])}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td />
                  {items.map((it) => (
                    <td key={it.id}>
                      <button
                        type="button"
                        className={`iui-btn iui-btn-sm ${it.id === selected ? "iui-btn-default" : "iui-btn-outline"}`}
                        onClick={() => {
                          setSelected(it.id);
                          emit(ctx, node, "select", {
                            value: it.id,
                            payload: { itemId: it.id, name: it.name },
                          });
                        }}
                      >
                        {it.id === selected ? "已选" : selectLabel}
                      </button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    return (
      <div className="iui-compare" data-iui-id={node.id}>
        {node.props?.title ? (
          <div className="iui-compare-title">{String(node.props.title)}</div>
        ) : null}
        <div className="iui-compare-cards">
          {items.map((it) => {
            const hot = it.id === selected || Boolean(it.highlight);
            return (
              <div
                key={it.id}
                className={`iui-compare-card${hot ? " iui-compare-card-hot" : ""}`}
              >
                <div className="iui-compare-card-head">
                  <div>
                    <div className="iui-compare-name">{it.name}</div>
                    {it.subtitle ? (
                      <div className="iui-compare-sub">{it.subtitle}</div>
                    ) : null}
                  </div>
                  {it.badge ? (
                    <span className="iui-badge iui-badge-default">{it.badge}</span>
                  ) : null}
                </div>
                <dl className="iui-compare-specs">
                  {aspectIds.map((a) => (
                    <div key={a.id}>
                      <dt>{a.label}</dt>
                      <dd>{it.values?.[a.id] == null ? "—" : String(it.values[a.id])}</dd>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  className={`iui-btn iui-btn-md iui-btn-block ${hot ? "iui-btn-default" : "iui-btn-outline"}`}
                  onClick={() => {
                    setSelected(it.id);
                    emit(ctx, node, "select", {
                      value: it.id,
                      payload: { itemId: it.id, name: it.name },
                    });
                  }}
                >
                  {it.id === selected ? "已选" : selectLabel}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  },

  "catalog.shadcn/Stepper": ({ node, ctx }) => {
    const steps =
      (node.props?.steps as Array<{ id: string; title: string; description?: string }>) ??
      [];
    const orientation = (node.props?.orientation as string) ?? "horizontal";
    const initial = node.props?.current;
    const initialIndex =
      typeof initial === "number"
        ? initial
        : Math.max(
            0,
            steps.findIndex((s) => s.id === String(initial ?? steps[0]?.id ?? "")),
          );
    const [index, setIndex] = useState(Math.min(Math.max(0, initialIndex), Math.max(0, steps.length - 1)));
    const step = steps[index];
    const atEnd = index >= steps.length - 1;
    const atStart = index <= 0;

    useEffect(() => {
      // sync if props.current changes from stream
      if (typeof node.props?.current === "number") {
        setIndex(Math.min(Math.max(0, Number(node.props.current)), Math.max(0, steps.length - 1)));
      }
    }, [node.props?.current, steps.length]);

    return (
      <div
        className={`iui-stepper iui-stepper-${orientation}`}
        data-iui-id={node.id}
      >
        {node.props?.title ? (
          <div className="iui-stepper-title">{String(node.props.title)}</div>
        ) : null}
        <ol className="iui-stepper-list">
          {steps.map((s, i) => (
            <li
              key={s.id}
              className={`iui-step${i === index ? " iui-step-active" : ""}${i < index ? " iui-step-done" : ""}`}
            >
              <button
                type="button"
                className="iui-step-dot"
                onClick={() => {
                  setIndex(i);
                  emit(ctx, node, "goto", {
                    value: s.id,
                    payload: { stepId: s.id, index: i },
                  });
                }}
              >
                {i < index ? "✓" : i + 1}
              </button>
              <div className="iui-step-meta">
                <div className="iui-step-name">{s.title}</div>
                {s.description ? (
                  <div className="iui-step-desc">{s.description}</div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        {step ? (
          <div className="iui-stepper-body">
            <div className="iui-stepper-current">
              <strong>{step.title}</strong>
              {step.description ? <p>{step.description}</p> : null}
            </div>
            <div className="iui-stepper-actions">
              <button
                type="button"
                className="iui-btn iui-btn-outline iui-btn-md"
                disabled={atStart}
                onClick={() => {
                  const next = Math.max(0, index - 1);
                  setIndex(next);
                  emit(ctx, node, "prev", {
                    value: steps[next]?.id,
                    payload: { stepId: steps[next]?.id, index: next },
                  });
                }}
              >
                {String(node.props?.prevLabel ?? "上一步")}
              </button>
              {atEnd ? (
                <button
                  type="button"
                  className="iui-btn iui-btn-default iui-btn-md"
                  onClick={() =>
                    emit(ctx, node, "complete", {
                      value: step.id,
                      payload: { stepId: step.id, index },
                    })
                  }
                >
                  {String(node.props?.completeLabel ?? "完成")}
                </button>
              ) : (
                <button
                  type="button"
                  className="iui-btn iui-btn-default iui-btn-md"
                  onClick={() => {
                    const next = Math.min(steps.length - 1, index + 1);
                    setIndex(next);
                    emit(ctx, node, "next", {
                      value: steps[next]?.id,
                      payload: { stepId: steps[next]?.id, index: next },
                    });
                  }}
                >
                  {String(node.props?.nextLabel ?? "下一步")}
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    );
  },

  "catalog.shadcn/Checklist": ({ node, ctx }) => {
    const raw =
      (node.props?.items as Array<{
        id: string;
        label: string;
        description?: string;
        checked?: boolean;
      }>) ?? [];
    const [items, setItems] = useState(
      raw.map((it) => ({ ...it, checked: Boolean(it.checked) })),
    );
    const showProgress = node.props?.showProgress !== false;
    const done = items.filter((i) => i.checked).length;
    const pct = items.length ? Math.round((done / items.length) * 100) : 0;

    useEffect(() => {
      setItems(raw.map((it) => ({ ...it, checked: Boolean(it.checked) })));
    }, [JSON.stringify(raw)]);

    return (
      <div className="iui-checklist" data-iui-id={node.id}>
        {node.props?.title ? (
          <div className="iui-checklist-title">{String(node.props.title)}</div>
        ) : null}
        {showProgress ? (
          <div className="iui-checklist-progress">
            <span>
              {done}/{items.length}
            </span>
            <div className="iui-progress">
              <span style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}
        <ul className="iui-checklist-list">
          {items.map((it) => (
            <li key={it.id} className={it.checked ? "iui-check-done" : ""}>
              <label className="iui-checkbox">
                <input
                  type="checkbox"
                  checked={it.checked}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setItems((prev) =>
                      prev.map((p) => (p.id === it.id ? { ...p, checked } : p)),
                    );
                    emit(ctx, node, "toggle", {
                      value: checked,
                      payload: { itemId: it.id, checked },
                    });
                  }}
                />
                <span>
                  <strong>{it.label}</strong>
                  {it.description ? (
                    <div className="iui-check-desc">{it.description}</div>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="iui-checklist-actions">
          <button
            type="button"
            className="iui-btn iui-btn-outline iui-btn-sm"
            onClick={() => {
              setItems((prev) => prev.map((p) => ({ ...p, checked: true })));
              emit(ctx, node, "check_all", { value: true });
            }}
          >
            全选
          </button>
          <button
            type="button"
            className="iui-btn iui-btn-default iui-btn-sm"
            disabled={done < items.length || items.length === 0}
            onClick={() =>
              emit(ctx, node, "complete", {
                value: true,
                payload: { done, total: items.length },
              })
            }
          >
            {String(node.props?.completeLabel ?? "全部完成")}
          </button>
        </div>
      </div>
    );
  },

  "catalog.shadcn/MapStub": ({ node, ctx }) => {
    const markers =
      (node.props?.markers as Array<{
        id: string;
        lat: number;
        lng: number;
        label?: string;
      }>) ?? [];
    const center = (node.props?.center as { lat: number; lng: number }) ??
      markers[0] ?? { lat: 31.23, lng: 121.47 };
    const zoom = Number(node.props?.zoom ?? 12);

    return (
      <div className="iui-map" data-iui-id={node.id}>
        {node.props?.title ? (
          <div className="iui-map-title">{String(node.props.title)}</div>
        ) : null}
        <div className="iui-map-canvas" aria-label="Map stub">
          <div className="iui-map-grid" />
          <div className="iui-map-meta">
            {center.lat.toFixed(2)}, {center.lng.toFixed(2)} · z{zoom}
          </div>
          {markers.map((m, i) => {
            const left = 15 + ((i * 23) % 70);
            const top = 20 + ((i * 17) % 55);
            return (
              <button
                key={m.id}
                type="button"
                className="iui-map-pin"
                style={{ left: `${left}%`, top: `${top}%` }}
                title={m.label ?? m.id}
                onClick={() =>
                  emit(ctx, node, "marker_click", {
                    value: m.id,
                    payload: { markerId: m.id, lat: m.lat, lng: m.lng },
                  })
                }
              >
                <span />
                {m.label ? <em>{m.label}</em> : null}
              </button>
            );
          })}
        </div>
        {node.props?.caption ? (
          <div className="iui-map-caption">{String(node.props.caption)}</div>
        ) : null}
      </div>
    );
  },

  "catalog.shadcn/GameShell": ({ node, ctx }) => {
    const init =
      (node.props?.board as Array<string | null>) ?? Array(9).fill(null);
    const [board, setBoard] = useState<Array<string | null>>(
      init.length === 9 ? [...init] : Array(9).fill(null),
    );
    const [turn, setTurn] = useState<"X" | "O">("X");
    const winner = calcWinner(board);
    const status =
      String(node.props?.status ?? "") ||
      (winner === "draw"
        ? "平局"
        : winner
          ? `${winner} 获胜`
          : `轮到 ${turn}`);

    return (
      <div className="iui-game" data-iui-id={node.id}>
        <div className="iui-game-head">
          <div className="iui-game-title">{String(node.props?.title ?? "井字棋")}</div>
          <div className="iui-game-status">{status}</div>
        </div>
        <div className="iui-game-board" role="grid">
          {board.map((cell, i) => (
            <button
              key={i}
              type="button"
              className="iui-game-cell"
              disabled={Boolean(cell) || Boolean(winner)}
              onClick={() => {
                if (cell || winner) return;
                const next = board.slice();
                next[i] = turn;
                setBoard(next);
                const w = calcWinner(next);
                emit(ctx, node, "move", {
                  value: i,
                  payload: { index: i, player: turn, board: next },
                });
                if (w && w !== "draw") {
                  emit(ctx, node, "win", { value: w, payload: { winner: w, board: next } });
                }
                setTurn(turn === "X" ? "O" : "X");
              }}
            >
              {cell ?? ""}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="iui-btn iui-btn-outline iui-btn-sm"
          onClick={() => {
            setBoard(Array(9).fill(null));
            setTurn("X");
            emit(ctx, node, "reset", { value: true });
          }}
        >
          重开
        </button>
      </div>
    );
  },
};
