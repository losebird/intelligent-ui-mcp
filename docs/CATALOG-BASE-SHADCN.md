# catalog.base & catalog.shadcn — 控件清单（① 真渲染）

> ComponentType = `{packageId}/{name}`。props 未列 `required` 的皆可选。示例均为单节点 JSON（可嵌进树）。

## catalog.base

布局与中性展示，无品牌皮肤；其它包可依赖它作骨架。

### Stack

| 项 | 值 |
|----|-----|
| name | `Stack` |
| description | 垂直/水平排列子节点 |
| slots | `children` |
| actions | 无 |

**props**

| prop | type | default | 说明 |
|------|------|---------|------|
| direction | `"vertical"\|"horizontal"` | `"vertical"` | |
| gap | number | 8 | px |
| align | `"start"\|"center"\|"end"\|"stretch"` | `"stretch"` | |
| wrap | boolean | false | |

```json
{
  "id": "root",
  "type": "catalog.base/Stack",
  "props": { "direction": "vertical", "gap": 12 },
  "children": []
}
```

### Grid

| 项 | 值 |
|----|-----|
| name | `Grid` |
| description | 简单响应式网格 |
| slots | `children` |

**props**：`columns` number default 2；`gap` number default 12。

### Markdown

| 项 | 值 |
|----|-----|
| name | `Markdown` |
| description | 安全 Markdown 子集（无 raw HTML） |

**props**：`text` string **required**。

```json
{ "id": "m1", "type": "catalog.base/Markdown", "props": { "text": "**结论**：建议方案 B" } }
```

### Text

**props**：`text` required；`variant`: `"body"|"muted"|"title"|"caption"` default `body`。

### Divider

无必填 props；`label?` string。

### Spacer

**props**：`size` number default 16。

### Image

**props**：`src` required（http(s) 或 data URL）；`alt` default `""`；`width?` `height?` number。  
**安全**：禁止 `javascript:` URL。

### CodeBlock

**props**：`code` required；`language?` string；`showLineNumbers?` boolean。

### Unknown

降级占位。**props**：`requestedType` string；`message?` string。系统自动插入，模型勿主动用。

### Callout

**props**：`tone`: `"info"|"warn"|"error"|"success"`；`title?`；`text` required。

---

## catalog.shadcn

视觉与交互对齐 shadcn/ui 惯用模式；实现可用 shadcn 组件或等价 headless+样式。

### Button

| actions | `click` → `onClick` |

**props**

| prop | type | default |
|------|------|---------|
| label | string | **required** |
| variant | `"default"\|"secondary"\|"outline"\|"destructive"\|"ghost"` | `"default"` |
| size | `"sm"\|"md"\|"lg"` | `"md"` |
| disabled | boolean | false |

```json
{
  "id": "b1",
  "type": "catalog.shadcn/Button",
  "props": { "label": "确认分摊", "variant": "default" },
  "actions": { "onClick": { "actionType": "submit", "payload": { "intent": "confirm_split" } } }
}
```

### ButtonGroup

**props**：`options` array of `{ id, label }` **required**；`variant?`。  
**actions**：`click` payload 含 `optionId`。

### Badge

**props**：`text` required；`variant`: `"default"\|"secondary"\|"outline"\|"destructive"`。

### Card

| slots | `children`（正文）；可选 props 区头 |

**props**：`title?`；`description?`。

```json
{
  "id": "c1",
  "type": "catalog.shadcn/Card",
  "props": { "title": "方案对比", "description": "按续航与价格" },
  "children": [
    { "id": "t", "type": "catalog.base/Markdown", "props": { "text": "| 型号 | 价 |\n| - | - |" } }
  ]
}
```

### Input

**props**：`label?`；`placeholder?`；`inputType` `"text"\|"email"\|"number"\|"password"` default `text`；`value?`；`disabled?`。  
**bind** 常用。**actions**：`change` / `submit`(Enter)。

### Textarea

同 Input，多 `rows?` number default 4。

### Slider

**props**：`label?`；`min` default 0；`max` default 100；`step` default 1；`value?` number。  
**actions**：`change`（松手或连续，Host 可 throttle）。**bind** 推荐。

```json
{
  "id": "tip",
  "type": "catalog.shadcn/Slider",
  "props": { "label": "小费 %", "min": 0, "max": 30, "step": 1, "value": 15 },
  "bind": "tipPercent"
}
```

### Switch

**props**：`label` required；`checked?` boolean。**actions**：`change`。

### Checkbox

**props**：`label` required；`checked?`。**actions**：`change`。

### Select

**props**：`label?`；`options` `{value,label}[]` required；`value?`；`placeholder?`。**actions**：`change`。

### Tabs

**props**：`items` `{id,label}[]` required；`value?` 当前 tab id。  
**slots**：`children` 与 items 顺序对齐，或子节点 `props.tabId`。  
**actions**：`change`。

### Table / DataTable

**name**：`DataTable`  
**props**：`columns` `{id,header,align?}[]` required；`rows` `Record<string,string|number|boolean|null>[]` required；`caption?`。  
无行内脚本。

```json
{
  "id": "dt1",
  "type": "catalog.shadcn/DataTable",
  "props": {
    "columns": [
      { "id": "name", "header": "姓名" },
      { "id": "amt", "header": "金额", "align": "right" }
    ],
    "rows": [
      { "name": "Ace", "amt": 120 },
      { "name": "Bob", "amt": 80 }
    ]
  }
}
```

### Form

| slots | `children` 字段控件 |

**props**：`submitLabel` default `"提交"`。  
**actions**：`submit`，payload 为 `{ values: Record<string, unknown> }`（Host 收集 bind/具名字段）。

### AlertDialog

**props**：`title`；`description`；`confirmLabel`；`cancelLabel?`；`open` boolean。  
**actions**：`confirm` / `cancel`。  
① 可先实现为内联 Card 模拟，③ 再做模态。

### Progress

**props**：`value` 0–100；`label?`。

### Separator

同 base Divider 的 shadcn 皮肤版；可映射到同一实现。

### Accordion

**props**：`items` `{id,title,content}[]` required（content 为 Markdown 字符串，① 简化）；`type` `"single"\|"multiple"` default single。

---

## ① 范围裁剪（必须真渲染的最小集）

**base（必做）**：`Stack`, `Markdown`, `Text`, `Divider`, `Callout`, `Unknown`, `Image`, `CodeBlock`  
**base（可顺带）**：`Grid`, `Spacer`  
**shadcn（必做）**：`Button`, `Badge`, `Card`, `Input`, `Slider`, `Switch`, `Select`, `DataTable`, `Form`, `Tabs`  
**shadcn（可顺带）**：`ButtonGroup`, `Textarea`, `Checkbox`, `Progress`, `Separator`, `Accordion`, `AlertDialog`

未列入「必做」的不得阻塞 ① 验收。

## 启用关系

- `catalog.base` **不可禁用**。
- 禁用 `catalog.shadcn` 时，prompt 片只引导 base + 纯文字；已有树中 shadcn 节点 → Host 显示 Unknown。

## 与其它 catalog 的占位

`catalog.radix|mui|antd|chakra|charts` 在 ⑥ 前：`renderStatus: "schema_only"`；清单另文，不在本文件展开。


---

## 高频模板（见 [`HF-TEMPLATES.md`](./HF-TEMPLATES.md)）

`catalog.shadcn` 另含：`Calculator`、`Comparison`、`Stepper`、`Checklist`、`MapStub`、`GameShell`。  
props / actions / ops 流式示例以 HF-TEMPLATES 为准。
