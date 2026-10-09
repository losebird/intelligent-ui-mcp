# 评测题集 v0 大纲（G7 / ⑥）

> 先定意图与期望，⑥ 再落 `evals/cases/*.json`。每题含：场景、期望格式（纯文字 / UI）、期望控件类型（可多选）、备注。

## 打分维（每题 0–2 分，人工或裁判）

| 维 | 0 | 1 | 2 |
|----|---|---|---|
| `format_choice` | 该纯文字却大 UI / 该 UI 却纯文字 | 勉强可接受 | 符合期望 |
| `component_fit` | 控件错误或缺失关键类型 | 部分合理 | 类型与布局恰当 |
| `stream_ok` | 仅终态闪现或失败 | 有树但不增量 | 增量可感或整树可接受（①） |
| `action_ok` | 需交互却无 / 坏 | 有按钮无闭环 | 点击可走 action→更新 |
| `safety` | 非法 type / 像脚本 | — | 仅注册 type |

**题目标签**：`plain` | `ui` | `ui+state`

---

## 题集（20+）

| # | 场景（用户意图） | 期望格式 | 期望控件（示例） | 标签 |
|---|------------------|----------|------------------|------|
| 1 | 「巴黎是哪个国家的首都？」 | 纯文字 | — | plain |
| 2 | 「用一句话解释什么是 TCP」 | 纯文字 | — | plain |
| 3 | 「2+2 等于几？」 | 纯文字 | — | plain |
| 4 | 「今天星期几？」（无工具也行） | 纯文字 | — | plain |
| 5 | 「把下面三个词按字母排序：pear, apple, orange」 | 纯文字或极简 | 可选 `Markdown` 列表；勿大 Card | plain |
| 6 | 「对比 iPhone 16 / Pixel 9 / Galaxy S25 的续航与售价（可虚构表）」 | UI | `DataTable` 或 `Card`+表；可选 `Tabs` | ui |
| 7 | 「画一个展示 Q1–Q4 营收趋势的示意折线（虚构数据）」 | UI | `catalog.charts/*` 若启用，否则 `DataTable`+说明 | ui |
| 8 | 「帮我做一个小费计算器：账单金额、小费比例、人数」 | UI+状态 | `Form`/`Input`/`Slider`/`Button`/`Badge` | ui+state |
| 9 | 「三个人 AA 制，录入每人垫资，算出谁该付给谁」 | UI+状态 | `DataTable` 或多 `Input` + `Button` | ui+state |
| 10 | 「用可点步骤说明怎么更换自行车内胎」 | UI | `Accordion` 或分步 `Card`+`Button`「下一步」 | ui |
| 11 | 「给我一个是否加班的二选一」 | UI | `ButtonGroup` 或两 `Button` | ui |
| 12 | 「解释光合作用，带一个可调光照强度看产物变化的示意」 | UI+状态 | `Slider` + `Markdown`/`Badge` | ui+state |
| 13 | 「列出登录表单该有的字段（只要说明）」 | 纯文字 | —（勿真出密码框除非用户要原型） | plain |
| 14 | 「给我一个登录页 UI 原型」 | UI | `Card`+`Form`+`Input`+`Button` | ui |
| 15 | 「把这段 JSON 格式化显示：{...}」 | UI 或代码 | `CodeBlock` | ui |
| 16 | 「警告我：删除仓库不可恢复」 | UI | `Callout` tone=warn/error 或 `AlertDialog` | ui |
| 17 | 「进度大概 65%，显示一下」 | UI | `Progress` | ui |
| 18 | 「用开关表示：启用通知 / 启用夜间模式」 | UI | 两 `Switch` | ui |
| 19 | 「下拉选一个时区：UTC / CST / EST」 | UI | `Select` | ui |
| 20 | 「用标签页分别展示『概述｜参数｜风险』三段虚构内容」 | UI | `Tabs`+`Markdown` | ui |
| 21 | 「只回答 yes 或 no：地球绕着太阳转吗？」 | 纯文字 | — | plain |
| 22 | 「生成一个错误码对照表：E001…E005」 | UI | `DataTable` | ui |
| 23 | 「我要自定义仪表盘控件（无包时）」 | 纯文字说明如何 register_package | — 或 `Callout`+`CodeBlock` | plain |
| 24 | 「同时启用 schema_only 的 antd 类型做按钮」 | UI 可降级 | 允许 `Unknown` 或映射到 shadcn Button；记 safety/fit | ui |
| 25 | 「空会话里乱点」（无用户题，Host 空状态） | 无 UI 树 | 空状态文案 | — |
| 30 | 「现在我的电脑内存怎么样」 | UI | `Card`+`Progress`+`Grid` 指标磁贴 | ui |
| 31 | 「今天北京天气怎么样」 | UI | `Card`+`LineChart`（+ `BarChart`） | ui |
| 32 | 「给我写一篇博士生的毕业论文」 | UI+状态 | `Form`+`ButtonGroup`+`Input` 采集 | ui+state |
| 33 | 「A 方案和 B 方案比哪个好」 | UI | `Comparison` / `DataTable` | ui |

## ⑥ 已落地文件形状

```json
{
  "id": "eval-008",
  "locale": "zh-CN",
  "prompt": "帮我做一个小费计算器：...",
  "expect": {
    "format": "ui",
    "tags": ["ui+state"],
    "anyOfTypes": [
      "catalog.shadcn/Slider",
      "catalog.shadcn/Input",
      "catalog.shadcn/Form"
    ],
    "forbidTypes": [],
    "needsAction": true
  }
}
```

## 回归节奏

- 每改 prompt 片 / lint / 裁判：跑 plain 子集（1–5,13,21）。
- 每改 catalog 映射：跑 ui 子集（6–12,14–20,22）。
- 每改 session/action：跑 8、9、12。

## 与 G1 关系

本题集 = G1 验收数据源；不在此承诺模型自动达标分数，只提供可重复场景。


## ⑤ 启发式冒烟（非 LLM）

`npm run policy-smoke` 用 Phase A `classifyFormat` 对题集子集做 format 期望比对（≥5 题）。  
**不**要求 ≤20% 误判——那是接真模型后的 ⑥ 标定。⑤ 只保证规则对 plain 题倾向 plain。


## ⑥ 运行方式

- 题文件：[`../evals/cases/*.json`](../evals/cases/)（≥20）
- 校验（CI 硬门槛）：`npm run eval:validate`
- 启发式 format 一轮：`npm run eval` → `evals/results/latest.md` + `latest.json`
- 人工全维打分：`evals/results/TEMPLATE.md`
- **不**宣称自动分数 = OpenAI 官方基准
