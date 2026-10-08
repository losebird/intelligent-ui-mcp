# Eval results template (G7)

> 人工或裁判打分用。自动 `npm run eval` 只跑 format 启发式，**不**宣称 = OpenAI 官方基准。

| id | format_choice (0–2) | component_fit (0–2) | stream_ok (0–2) | action_ok (0–2) | safety (0–2) | notes |
|----|---------------------|---------------------|-----------------|-----------------|--------------|-------|
| eval-001 | | | | | | |
| eval-002 | | | | | | |
| … | | | | | | |

## 维说明

见 `docs/EVAL-SET-V0.md`。分数由人工或可选裁判填写；CI 只做 `npm run eval:validate`。

## 样例跑次

见同目录 `latest.json` / `latest.md`（gitignore 可忽略大历史；保留 template + 一次样例）。
