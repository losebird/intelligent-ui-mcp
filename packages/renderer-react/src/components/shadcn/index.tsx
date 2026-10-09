import { useState } from "react";
import type { ComponentRenderer, RenderAction, UiNode } from "../../types.js";
import { templateRenderers } from "./templates.js";

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

export const shadcnRenderers: Record<string, ComponentRenderer> = {
  ...templateRenderers,
  "catalog.shadcn/Button": ({ node, ctx }) => {
    const variant = (node.props?.variant as string) ?? "default";
    const size = (node.props?.size as string) ?? "md";
    return (
      <button
        className={`iui-btn iui-btn-${variant} iui-btn-${size}`}
        disabled={Boolean(node.props?.disabled)}
        data-iui-id={node.id}
        onClick={() =>
          emit(ctx, node, node.actions?.onClick?.actionType ?? "click", {
            payload: node.actions?.onClick?.payload,
          })
        }
      >
        {String(node.props?.label ?? "Button")}
      </button>
    );
  },

  "catalog.shadcn/ButtonGroup": ({ node, ctx }) => {
    const options = (node.props?.options as Array<{ id: string; label: string }>) ?? [];
    const variant = (node.props?.variant as string) ?? "outline";
    const segmented = Boolean(node.props?.segmented) || variant === "segmented";
    const [active, setActive] = useState(String(node.props?.value ?? options[0]?.id ?? ""));
    return (
      <div
        className={segmented ? "iui-btn-group iui-btn-group-segmented" : "iui-btn-group"}
        data-iui-id={node.id}
        role={segmented ? "tablist" : undefined}
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={
              segmented
                ? `iui-btn iui-btn-sm${o.id === active ? " iui-btn-active" : ""}`
                : `iui-btn iui-btn-${variant === "segmented" ? "outline" : variant} iui-btn-md`
            }
            data-active={segmented && o.id === active ? "1" : undefined}
            onClick={() => {
              if (segmented) setActive(o.id);
              emit(ctx, node, "click", { payload: { optionId: o.id } });
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  },

  "catalog.shadcn/Badge": ({ node }) => {
    const variant = (node.props?.variant as string) ?? "default";
    return (
      <span className={`iui-badge iui-badge-${variant}`} data-iui-id={node.id}>
        {String(node.props?.text ?? "")}
      </span>
    );
  },

  "catalog.shadcn/Card": ({ node, renderChildren }) => (
    <div className="iui-card" data-iui-id={node.id}>
      {node.props?.title ? (
        <div className="iui-card-title">{String(node.props.title)}</div>
      ) : null}
      {node.props?.description ? (
        <div className="iui-card-desc">{String(node.props.description)}</div>
      ) : null}
      <div className="iui-card-body">{renderChildren(node.children)}</div>
    </div>
  ),

  "catalog.shadcn/Input": ({ node, ctx }) => {
    const [value, setValue] = useState(String(node.props?.value ?? ""));
    return (
      <div className="iui-field" data-iui-id={node.id}>
        {node.props?.label ? <label>{String(node.props.label)}</label> : null}
        <input
          className="iui-input"
          type={(node.props?.inputType as string) ?? "text"}
          placeholder={node.props?.placeholder as string | undefined}
          disabled={Boolean(node.props?.disabled)}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            emit(ctx, node, "change", {
              value: e.target.value,
              path: node.bind,
            });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              emit(ctx, node, "submit", { value, path: node.bind });
            }
          }}
        />
      </div>
    );
  },

  "catalog.shadcn/Textarea": ({ node, ctx }) => {
    const [value, setValue] = useState(String(node.props?.value ?? ""));
    return (
      <div className="iui-field" data-iui-id={node.id}>
        {node.props?.label ? <label>{String(node.props.label)}</label> : null}
        <textarea
          className="iui-textarea"
          rows={Number(node.props?.rows ?? 4)}
          placeholder={node.props?.placeholder as string | undefined}
          disabled={Boolean(node.props?.disabled)}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            emit(ctx, node, "change", { value: e.target.value, path: node.bind });
          }}
        />
      </div>
    );
  },

  "catalog.shadcn/Slider": ({ node, ctx }) => {
    const min = Number(node.props?.min ?? 0);
    const max = Number(node.props?.max ?? 100);
    const step = Number(node.props?.step ?? 1);
    const [value, setValue] = useState(Number(node.props?.value ?? min));
    const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
    return (
      <div className="iui-field" data-iui-id={node.id}>
        <label>
          <span>{String(node.props?.label ?? "Value")}</span>
          <span className="iui-field-value">{value}</span>
        </label>
        <input
          className="iui-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          style={{ ["--iui-slider-pct" as string]: `${pct}%` }}
          onChange={(e) => {
            const v = Number(e.target.value);
            setValue(v);
            emit(ctx, node, "change", { value: v, path: node.bind });
          }}
        />
      </div>
    );
  },

  "catalog.shadcn/Switch": ({ node, ctx }) => {
    const [checked, setChecked] = useState(Boolean(node.props?.checked));
    return (
      <label className="iui-switch" data-iui-id={node.id}>
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => {
            setChecked(e.target.checked);
            emit(ctx, node, "change", {
              value: e.target.checked,
              path: node.bind,
            });
          }}
        />
        <span className="iui-switch-track" aria-hidden="true" />
        {String(node.props?.label ?? "")}
      </label>
    );
  },

  "catalog.shadcn/Checkbox": ({ node, ctx }) => {
    const [checked, setChecked] = useState(Boolean(node.props?.checked));
    return (
      <label className="iui-checkbox" data-iui-id={node.id}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            setChecked(e.target.checked);
            emit(ctx, node, "change", {
              value: e.target.checked,
              path: node.bind,
            });
          }}
        />
        {String(node.props?.label ?? "")}
      </label>
    );
  },

  "catalog.shadcn/Select": ({ node, ctx }) => {
    const options =
      (node.props?.options as Array<{ value: string; label: string }>) ?? [];
    const [value, setValue] = useState(String(node.props?.value ?? ""));
    return (
      <div className="iui-field" data-iui-id={node.id}>
        {node.props?.label ? <label>{String(node.props.label)}</label> : null}
        <select
          className="iui-select"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            emit(ctx, node, "change", {
              value: e.target.value,
              path: node.bind,
            });
          }}
        >
          {node.props?.placeholder ? (
            <option value="">{String(node.props.placeholder)}</option>
          ) : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  },

  "catalog.shadcn/Tabs": ({ node, ctx, renderChildren }) => {
    const items =
      (node.props?.items as Array<{ id: string; label: string }>) ?? [];
    const [value, setValue] = useState(
      String(node.props?.value ?? items[0]?.id ?? ""),
    );
    const children = node.children ?? [];
    const activeIndex = Math.max(
      0,
      items.findIndex((i) => i.id === value),
    );
    const activeChild =
      children.find((c) => c.props?.tabId === value) ?? children[activeIndex];
    return (
      <div data-iui-id={node.id}>
        <div className="iui-tabs-list">
          {items.map((item) => (
            <button
              key={item.id}
              className={`iui-tab ${item.id === value ? "iui-tab-active" : ""}`}
              onClick={() => {
                setValue(item.id);
                emit(ctx, node, "change", { value: item.id });
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {activeChild ? renderChildren([activeChild]) : null}
      </div>
    );
  },

  "catalog.shadcn/DataTable": ({ node }) => {
    const rawColumns =
      (node.props?.columns as Array<{
        id?: string;
        key?: string;
        header?: string;
        label?: string;
        align?: string;
      }>) ?? [];
    // Accept both schema shape {id,header} and common alias {key,label}.
    const columns = rawColumns.map((c) => {
      const id = String(c.id ?? c.key ?? "");
      const header = String(c.header ?? c.label ?? id);
      return { id, header, align: c.align };
    });
    const rows =
      (node.props?.rows as Array<Record<string, string | number | boolean | null>>) ??
      [];
    return (
      <div className="iui-table-wrap" data-iui-id={node.id}>
        <table className="iui-table">
          {node.props?.caption ? <caption>{String(node.props.caption)}</caption> : null}
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.id} style={{ textAlign: (c.align as "left") ?? "left" }}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={Math.max(columns.length, 1)} style={{ color: "var(--iui-muted)" }}>
                  暂无数据
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.id} style={{ textAlign: (c.align as "left") ?? "left" }}>
                      {row[c.id] == null ? "" : String(row[c.id])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  },

  "catalog.shadcn/Form": ({ node, ctx, renderChildren }) => {
    const submitLabel = String(node.props?.submitLabel ?? "提交");
    const cancelLabel = node.props?.cancelLabel
      ? String(node.props.cancelLabel)
      : "";
    const dual = Boolean(cancelLabel);
    return (
      <form
        className="iui-form"
        data-iui-id={node.id}
        onSubmit={(e) => {
          e.preventDefault();
          emit(ctx, node, "submit", {
            payload: { values: ctx.state },
          });
        }}
      >
        {renderChildren(node.children)}
        <div className={dual ? "iui-form-actions iui-form-actions-2" : "iui-form-actions"}>
          {dual ? (
            <button
              className="iui-btn iui-btn-secondary iui-btn-md iui-btn-block"
              type="button"
              onClick={() => emit(ctx, node, "cancel")}
            >
              {cancelLabel}
            </button>
          ) : null}
          <button className="iui-btn iui-btn-default iui-btn-md iui-btn-block" type="submit">
            {submitLabel}
          </button>
        </div>
      </form>
    );
  },

  "catalog.shadcn/AlertDialog": ({ node, ctx }) => {
    if (node.props?.open === false) return null;
    return (
      <div className="iui-alert" data-iui-id={node.id}>
        <div className="iui-card-title">{String(node.props?.title ?? "")}</div>
        <div className="iui-card-desc">{String(node.props?.description ?? "")}</div>
        <div className="iui-btn-group">
          <button
            className="iui-btn iui-btn-default iui-btn-md"
            onClick={() => emit(ctx, node, "confirm")}
          >
            {String(node.props?.confirmLabel ?? "确认")}
          </button>
          <button
            className="iui-btn iui-btn-outline iui-btn-md"
            onClick={() => emit(ctx, node, "cancel")}
          >
            {String(node.props?.cancelLabel ?? "取消")}
          </button>
        </div>
      </div>
    );
  },

  "catalog.shadcn/Progress": ({ node }) => {
    const value = Math.max(0, Math.min(100, Number(node.props?.value ?? 0)));
    return (
      <div data-iui-id={node.id}>
        {node.props?.label ? <div>{String(node.props.label)}</div> : null}
        <div className="iui-progress">
          <span style={{ width: `${value}%` }} />
        </div>
      </div>
    );
  },

  "catalog.shadcn/Separator": ({ node }) => {
    const label = node.props?.label as string | undefined;
    if (label) {
      return (
        <div className="iui-divider-label" data-iui-id={node.id}>
          <span>{label}</span>
        </div>
      );
    }
    return <hr className="iui-divider" data-iui-id={node.id} />;
  },

  "catalog.shadcn/Accordion": ({ node }) => {
    const items =
      (node.props?.items as Array<{ id: string; title: string; content: string }>) ??
      [];
    return (
      <div className="iui-accordion" data-iui-id={node.id}>
        {items.map((item) => (
          <details key={item.id}>
            <summary>{item.title}</summary>
            <div>{item.content}</div>
          </details>
        ))}
      </div>
    );
  },
};
