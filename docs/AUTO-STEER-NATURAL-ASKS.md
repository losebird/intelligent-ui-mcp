# 自然问句自动选用 UI（无需口头禅）

叠在 PR #10（`polish/lightweight-motion`）上。对标 OpenAI Intelligent UI：散文 + 气泡内交互控件。用户**不必**说「必须用 Intelligent UI 工具」。

## 自然问句应有行为

| 用户怎么问 | 同一回合应发生什么 |
|------------|-------------------|
| 「现在我的电脑内存怎么样」 | 1–3 句判断 + `ui_open` → `ui_propose` 资源磁贴（`Grid`/`Card`/`Progress`）。缺真实采样可用示意数字。禁止纯 Markdown、禁止 `plainTextFallback`、禁止空壳。 |
| 「今天北京天气怎么样」 | 短散文 + 天气卡（当前况 + 逐小时 `LineChart` + 未来几天 `BarChart`）。 |
| 「给我写一篇博士生的毕业论文」 | 先采集缺参：`Form` + `ButtonGroup`（学科/语言/格式）+ `Input`（题目）。不要用 Markdown 列表代替表单。 |
| 「A 方案和 B 方案比哪个好」 | `Comparison` 或 `DataTable`，`mode=ops` 分片。 |

事实题（「巴黎是哪个国家的首都？」「今天星期几？」）和「只要说明」仍走纯文字。

## 本仓库改了什么

1. **MCP `instructions`**（`createIntelligentUiServer` 第二参）写入 `buildAlwaysOnInstructions()`。dsh-mcp-client / Cursor 在 initialize 时即可注入，不必先调 `get_prompt_fragment`。
2. **`get_prompt_fragment`** 前置同一段自动选用 + 三份窄食谱（`packages/mcp-server/src/recipes.ts`）。
3. **`classifyFormat`**：资源看板 / 天气 / 多字段采集 / A vs B → `ui`。短问启发式不再把「内存怎么样」判成 `plain_text`。
4. **empty-shell / mustPropose / Host auth 未削弱**。`ui_open` 额外返回 `sameTurnPropose` 提醒。

## 兄弟插件 `dsh-intelligent-ui`（本 monorepo 不在）

本仓库**没有** `/workspace/dsh-plugins/dsh-intelligent-ui`。losebird 组织下也没有可写的同名仓库。公开的 [yunyv/dsh-intelligent-ui](https://github.com/yunyv/dsh-intelligent-ui) 是另一套 DIL/`artifact` 插件，**不要**当成本 MCP 包装去改。

协调员若在本机 DSH 插件树里改自动注入的短 prompt，按下面补丁套到：

`/workspace/dsh-plugins/dsh-intelligent-ui`（常见文件：`src/prompt.ts` / `src/index.ts` / 任何导出 `PROMPT_TEXT` 的模块）

### 补丁（把过短的 `PROMPT_TEXT` 换成自动选用，勿覆盖 MCP instructions）

```ts
// BEFORE (too short — models skip UI unless the user says the magic phrase)
export const PROMPT_TEXT = `需要交互界面时调用 Intelligent UI MCP。用户明确要求「必须用 Intelligent UI」再 ui_open。`;

// AFTER — keep in sync with packages/mcp-server/src/steer.ts (STEER_VERSION 0.4.0-auto-steer)
export const PROMPT_TEXT = `
# Intelligent UI 自动选用（无需口头禅）
用户不必说「必须用 Intelligent UI / 用 ui_open」。
资源看板、天气、多字段采集、A vs B 对比：同一回合 ui_open → ui_propose（真实 tree/ops）。
禁止空壳、禁止 plainTextFallback、禁止等 EMPTY_SHELL_TIMEOUT。
短问「内存/天气怎么样」是 UI，不是 plain_text。
MCP initialize instructions 已含完整规则与食谱；不要覆盖成更短的 stub。
get_prompt_fragment 可选。
`;
```

若插件自己的 MCP client 会把 `connection.instructions` 注入系统提示：

- **保留** server 下发的 instructions（本 PR 已填满）。
- 不要再注入一段更短的、要求口头禅的 `PROMPT_TEXT` 把它冲掉。
- empty-shell / `mustPropose` 守卫保持原样。

## 验收

```bash
npm run build
npm run policy-smoke
npm run eval:validate
npm run eval
```

`classify` 应对 eval-030/031/032/033 判 `ui`，eval-001/004/013/023 仍为 `plain_text`。
