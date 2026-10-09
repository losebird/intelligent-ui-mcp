# Eval heuristic results (auto)

Generated: 2026-10-09T17:40:28.615Z

Format accuracy: **32/32** = 100.0% (heuristic only; not a CI hard fail for MISS).

Auto scores ≠ OpenAI official benchmark. Fill `TEMPLATE.md` for full dimensions.

| id | expect | heuristic | match | suggested_types | reasons |
|----|--------|-----------|-------|-----------------|---------|
| eval-001 | plain_text | plain_text | OK | — | plain: factual / arithmetic; plain: short closed question heuristic |
| eval-002 | plain_text | plain_text | OK | — | plain: one-sentence definition; plain: short closed question heuristic |
| eval-003 | plain_text | plain_text | OK | — | plain: factual / arithmetic; plain: short closed question heuristic |
| eval-004 | plain_text | plain_text | OK | — | plain: factual / arithmetic; plain: short closed question heuristic |
| eval-005 | plain_text | plain_text | OK | — | plain: short closed question heuristic |
| eval-006 | ui | ui | OK | catalog.shadcn/Comparison, catalog.shadcn/DataTable, catalog.shadcn/Card, catalog.shadcn/Tabs | ui: comparison |
| eval-007 | ui | ui | OK | catalog.shadcn/DataTable, catalog.charts/LineChart, catalog.shadcn/Slider, catalog.base/Markdown | ui: trend / chart; ui: interactive demo |
| eval-008 | ui | ui | OK | catalog.shadcn/Form, catalog.shadcn/Slider, catalog.shadcn/Input, catalog.shadcn/Button | ui: calculator / adjustable params |
| eval-009 | ui | ui | OK | catalog.shadcn/Form, catalog.shadcn/Slider, catalog.shadcn/Input, catalog.shadcn/Button | ui: calculator / adjustable params |
| eval-010 | ui | ui | OK | catalog.shadcn/Accordion, catalog.shadcn/Card, catalog.shadcn/Button | ui: step / process |
| eval-011 | ui | ui | OK | catalog.shadcn/ButtonGroup, catalog.shadcn/Button | ui: binary choice |
| eval-012 | ui | ui | OK | catalog.shadcn/Form, catalog.shadcn/Slider, catalog.shadcn/Input, catalog.shadcn/Button | ui: calculator / adjustable params; ui: interactive demo |
| eval-013 | plain_text | plain_text | OK | — | plain: explanation-only |
| eval-014 | ui | ui | OK | catalog.shadcn/Card, catalog.shadcn/Form, catalog.shadcn/Input, catalog.shadcn/Button | ui: form prototype |
| eval-015 | ui | ui | OK | — | ui: explicit UI widget ask |
| eval-016 | ui | ui | OK | catalog.base/Callout, catalog.shadcn/AlertDialog | ui: explicit UI widget ask |
| eval-017 | ui | ui | OK | catalog.shadcn/Progress | ui: explicit UI widget ask |
| eval-018 | ui | ui | OK | catalog.shadcn/Switch | ui: explicit UI widget ask |
| eval-019 | ui | ui | OK | catalog.shadcn/Select | ui: explicit UI widget ask |
| eval-020 | ui | ui | OK | catalog.shadcn/Tabs | ui: explicit UI widget ask |
| eval-021 | plain_text | plain_text | OK | — | plain: yes/no; plain: boolean / closed question; plain: short closed question heuristic |
| eval-022 | ui | ui | OK | catalog.shadcn/DataTable | ui: explicit UI widget ask |
| eval-023 | plain_text | plain_text | OK | — | plain: explanation-only; plain: short closed question heuristic |
| eval-024 | ui | ui | OK | catalog.antd/Button, catalog.shadcn/Button | ui: schema-only / vendor button UI |
| eval-025 | plain_text | (host empty — skipped) | OK | — | hostEmpty skip |
| eval-026 | ui | ui | OK | catalog.shadcn/Form, catalog.shadcn/Slider, catalog.shadcn/Input, catalog.shadcn/Button | ui: calculator / adjustable params |
| eval-027 | ui | ui | OK | catalog.shadcn/Comparison, catalog.shadcn/DataTable, catalog.shadcn/Card, catalog.shadcn/Tabs | ui: comparison |
| eval-028 | ui | ui | OK | catalog.shadcn/Accordion, catalog.shadcn/Card, catalog.shadcn/Button | ui: step / process |
| eval-029 | ui | ui | OK | catalog.shadcn/Checklist | ui: checklist |
| eval-030 | ui | ui | OK | catalog.shadcn/Card, catalog.shadcn/Progress, catalog.base/Grid, catalog.charts/LineChart | ui: resource / system dashboard |
| eval-031 | ui | ui | OK | catalog.shadcn/Card, catalog.base/Stack, catalog.charts/LineChart | ui: weather card |
| eval-032 | ui | ui | OK | catalog.shadcn/Form, catalog.shadcn/Input, catalog.shadcn/ButtonGroup, catalog.shadcn/Card | ui: multi-field intake form |
| eval-033 | ui | ui | OK | catalog.shadcn/Comparison, catalog.shadcn/DataTable, catalog.shadcn/Card, catalog.shadcn/Tabs | ui: comparison |
