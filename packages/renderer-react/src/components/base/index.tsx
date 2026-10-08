import type { ComponentRenderer } from "../../types.js";
import { renderMarkdownToHtml } from "../../markdown.js";

export const baseRenderers: Record<string, ComponentRenderer> = {
  "catalog.base/Stack": ({ node, renderChildren }) => {
    const direction = (node.props?.direction as string) ?? "vertical";
    const gap = Number(node.props?.gap ?? 8);
    const align = (node.props?.align as string) ?? "stretch";
    const wrap = Boolean(node.props?.wrap);
    return (
      <div
        className={`iui-stack ${direction === "horizontal" ? "iui-stack-h" : "iui-stack-v"}`}
        style={{
          gap,
          alignItems: align === "stretch" ? "stretch" : align,
          flexWrap: wrap ? "wrap" : "nowrap",
        }}
        data-iui-id={node.id}
      >
        {renderChildren(node.children)}
      </div>
    );
  },

  "catalog.base/Grid": ({ node, renderChildren }) => {
    const columns = Number(node.props?.columns ?? 2);
    const gap = Number(node.props?.gap ?? 12);
    return (
      <div
        className="iui-grid"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap }}
        data-iui-id={node.id}
      >
        {renderChildren(node.children)}
      </div>
    );
  },

  "catalog.base/Markdown": ({ node }) => {
    const text = String(node.props?.text ?? "");
    return (
      <div
        className="iui-md"
        data-iui-id={node.id}
        dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(text) }}
      />
    );
  },

  "catalog.base/Text": ({ node }) => {
    const variant = (node.props?.variant as string) ?? "body";
    return (
      <p className={`iui-text-${variant}`} data-iui-id={node.id}>
        {String(node.props?.text ?? "")}
      </p>
    );
  },

  "catalog.base/Divider": ({ node }) => {
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

  "catalog.base/Spacer": ({ node }) => {
    const size = Number(node.props?.size ?? 16);
    return <div style={{ height: size }} data-iui-id={node.id} />;
  },

  "catalog.base/Image": ({ node }) => {
    const src = String(node.props?.src ?? "");
    if (/^javascript:/i.test(src)) {
      return (
        <div className="iui-unknown" data-iui-id={node.id}>
          Blocked unsafe image URL
        </div>
      );
    }
    return (
      <img
        className="iui-img"
        src={src}
        alt={String(node.props?.alt ?? "")}
        width={node.props?.width as number | undefined}
        height={node.props?.height as number | undefined}
        data-iui-id={node.id}
      />
    );
  },

  "catalog.base/CodeBlock": ({ node }) => {
    const code = String(node.props?.code ?? "");
    const language = node.props?.language ? String(node.props.language) : undefined;
    return (
      <pre className="iui-code" data-iui-id={node.id} data-language={language}>
        <code>{code}</code>
      </pre>
    );
  },

  "catalog.base/Unknown": ({ node }) => (
    <div className="iui-unknown" data-iui-id={node.id}>
      Unknown type: {String(node.props?.requestedType ?? "?")}
      {node.props?.message ? ` — ${String(node.props.message)}` : ""}
    </div>
  ),

  "catalog.base/Callout": ({ node }) => {
    const tone = (node.props?.tone as string) ?? "info";
    return (
      <div className={`iui-callout iui-callout-${tone}`} data-iui-id={node.id}>
        {node.props?.title ? <strong>{String(node.props.title)}</strong> : null}
        <div>{String(node.props?.text ?? "")}</div>
      </div>
    );
  },
};
