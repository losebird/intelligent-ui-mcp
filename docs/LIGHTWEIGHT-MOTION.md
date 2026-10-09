# Lightweight Motion（轻量动效）

> 日期：2026-10-09（Asia/Shanghai）  
> **不是** Claude Artifacts **Dashboards / Motion**（代码动画导出 MP4）。  
> 本仓只做 ops 流式上屏时的 **CSS 渐入 / shimmer / 布局过渡**，且 **禁止为动效 remount**。

## 目标

| 信号 | 做法 |
|------|------|
| 节点首次出现 | `NodeMotionShell`：`opacity` + `translateY(6px)` → 归位（~220ms） |
| 仍在生成 | `SkeletonPlaceholder` block（空树）/ inline（已有树）shimmer |
| 布局变化 | `.iui-stack` / `.iui-grid` 的 `gap` transition；卡片阴影/边框轻过渡 |
| 无障碍 | `prefers-reduced-motion: reduce` → 全部 animation/transition 关闭 |
| 不 remount | React `key={node.id}` + shell 只在首次 mount 播 enter；`patch_props` 保留 DOM |

## 非目标

- Claude Motion（代码驱动 timeline → 视频）
- FLIP 全量布局动画 / layout thrashing
- 为「好看」改 `key` 或 `replace_tree`（见 [`DATA-VS-RENDER.md`](./DATA-VS-RENDER.md)）

## API

```tsx
<UiRenderer
  tree={tree}
  streaming={partial}   // 显示 skeleton
  motion={true}         // 默认开；false 关掉 enter
/>

<HostSurfaceView motion sessionId surface … />
```

导出：`NodeMotionShell`、`SkeletonPlaceholder`、`prefersReducedMotion`。

## DOM 标记

| 属性 | 含义 |
|------|------|
| `data-iui-node-id` | 稳定节点 id（= React key） |
| `data-iui-motion="enter\|done\|skipped\|off\|pending"` | 入场状态 |
| `data-iui-reduced-motion="0\|1"` | 根上反映系统偏好 |
| `data-iui-skeleton` | `block` / `inline` 占位 |
| `.iui-motion-on` / `.iui-motion-off` | 根 class |

## 验收

```bash
npm run build
npm run motion-smoke   # → MOTION_SMOKE_OK
```

可选帧序列（本机 Playwright）：

```bash
IUI_MOTION_OUT=/workspace/intelligent-ui-mcp-verify \
  node scripts/motion-capture.mjs
# → motion-frame-00.png … / motion-reduced.png / MOTION-CAPTURE.md
```

## 与竞品边界

| 产品 | 我们 |
|------|------|
| OpenAI Intelligent UI | 原生流式组件编译器；我们仅 CSS 体感补丁 |
| OpenUI `isStreaming` | 同气泡 parser；我们 Host/气泡 iframe 内壳 |
| Claude Dashboards/Motion | 活看板 + 代码动画；**本仓明确不冒充** |
