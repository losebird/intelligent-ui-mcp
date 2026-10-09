# OpenAI Intelligent UI / Apps SDK UI 观感差距（2026-10-09）

对照来源：
- https://openai.com/index/gpt-6-for-everyone/（Intelligent UI 产品页）
- https://developers.openai.com/apps-sdk/concepts/ui-guidelines
- `@openai/apps-sdk-ui@0.2.2` design tokens（rounded-2xl / gray-0…1000 / soft buttons / hairline border）

## 差距清单（改前 → 目标）

| 维度 | 我们（改前） | OpenAI / ChatGPT | 本轮处理 |
|------|-------------|------------------|----------|
| 主色按钮 | 亮蓝渐变 `#3b82f6→#2563eb` | 近黑 solid `#0d0d0d`，链接/焦点用 `#0285ff` | ✅ |
| 次按钮 | 灰底/描边偏「后台」 | soft：浅灰底、无重边框 | ✅ |
| 边框 | `#e2e8f0` 实线偏重 | hairline `rgba(0,0,0,.08)` | ✅ |
| 卡片圆角 | 16px 但阴影偏「浮岛」 | `rounded-2xl` + 轻 elevation | ✅ |
| 字号密度 | 14px + 大 padding，聊天气泡里空 | body 14 / caption 13，气泡内更紧 | ✅ |
| 表头 | UPPERCASE + muted 管理台风 | sentence case，常规字重 | ✅ |
| Switch | 原生 checkbox | 32×19 轨道 + thumb | ✅ |
| Tabs | 底边指示条 | Segmented soft pill | ✅ |
| 表单 CTA | 随便一颗蓝按钮 | 底部分隔线 + ≤2 CTA（主+次） | ✅ |
| 流式 | Host 顶栏 banner | 卡片内 shimmer，无工具壳 | ✅ 部分 |
| iframe 气泡 | 固定 360 高，大片空白 | 内容自适应高度 | ✅ postMessage |
| 真原生气泡节点 | toolview iframe | 宿主 native mount | ❌ 产品限制 |

## 仍差（本轮刻意不伪装已解决）

1. **原生气泡节点**：仍是 dsh `tool.call.toolview` iframe，不是助手消息树节点。
2. **模型设计判断**：OpenAI 有训练过的 layout/组件选择；我们靠 prompt + catalog。
3. **跨端原生组件库**：Apps SDK UI 有 Radix + 完整控件态；我们是轻量 CSS 仿。
4. **Display modes**：无 PiP / fullscreen 宿主协商。
5. **暗色主题**：token 预留，未做完整 dark。
