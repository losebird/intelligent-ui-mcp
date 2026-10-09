# 高频 Intelligent UI 模板（Calculator / Comparison / Stepper / Checklist）

> 战略：私有 `ui.*` + 宿主插件。本页缩小与 ChatGPT Intelligent UI 演示题的组件差距。  
> ComponentType = `catalog.shadcn/{Name}`。均可本地交互并 emit actions → Host `POST /api/action` → `ui_drain_actions`。

## 清单

| 组件 | actions | 典型题 |
|------|---------|--------|
| `Calculator` | `press` / `equals` / `clear` | 「给我一个计算器」 |
| `Comparison` | `select` | 「对比三款手机 / 两款笔记本」 |
| `Stepper` | `next` / `prev` / `goto` / `complete` | 「分步开户 / onboarding」 |
| `Checklist` | `toggle` / `check_all` / `complete` | 「上线 checklist」 |
| `MapStub` | `marker_click` | 「附近门店示意」（无瓦片 API） |
| `GameShell` | `move` / `reset` / `win` | 「井字棋」轻量对战壳 |

## Calculator

```json
{
  "id": "calc",
  "type": "catalog.shadcn/Calculator",
  "props": { "title": "计算器", "expression": "0" }
}
```

本地解析四则运算（无 `Function`/`eval`）；`equals` payload: `{ expression, result }`。

## Comparison（推荐 ops 流式）

1. 壳：`items: []` + `aspects`  
2. 多次 `patch_props` / upsert 追加 `items`（`chunkDone:false`）  
3. 最后 `chunkDone:true`

```json
{
  "id": "cmp",
  "type": "catalog.shadcn/Comparison",
  "props": {
    "title": "三款旗舰对比",
    "layout": "cards",
    "aspects": [
      { "id": "chip", "label": "芯片" },
      { "id": "price", "label": "价格" }
    ],
    "items": [
      {
        "id": "iphone",
        "name": "iPhone 16 Pro",
        "badge": "影像",
        "values": { "chip": "A18 Pro", "price": "¥9999" }
      }
    ]
  }
}
```

`layout`: `"cards"` | `"table"`。`select` → `{ itemId, name }`。

## Stepper

```json
{
  "id": "steps",
  "type": "catalog.shadcn/Stepper",
  "props": {
    "title": "开户",
    "current": 0,
    "steps": [
      { "id": "s1", "title": "身份", "description": "上传证件" },
      { "id": "s2", "title": "资料" },
      { "id": "s3", "title": "确认" }
    ]
  }
}
```

## Checklist

```json
{
  "id": "todo",
  "type": "catalog.shadcn/Checklist",
  "props": {
    "title": "上线清单",
    "items": [
      { "id": "c1", "label": "鉴权", "checked": true },
      { "id": "c2", "label": "SSE" }
    ]
  }
}
```

## MapStub / GameShell

- MapStub：示意网格 + pins，**不**拉地图瓦片。  
- GameShell：`kind: "tictactoe"`（默认），九宫格对战。

## 冒烟

```bash
npm run build
npm run templates-smoke
# 可选：IUI_SESSION_DIR=~/.intelligent-ui-mcp/templates-demo npm run templates-smoke
# 然后 IUI_SESSION_DIR=… npm run host 看画面
```

验收：`TEMPLATES_SMOKE_OK`；Comparison items 0→1→2→3；`select` action 可 drain。

## 与 ChatGPT 演示题差距（仍存）

- 无 RL 布局裁判；靠 prompt + lint。  
- Map 无真地图；Game 仅井字棋壳。  
- 气泡挂载仍依赖宿主插件 / toolview，不是纯助手节点。
