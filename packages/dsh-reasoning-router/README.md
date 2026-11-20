# dsh-reasoning-router

自动判断一段文本是**闲聊**还是**任务**，给任务打**难度分（1–5）**，再据此建议
**推理强度**（low / medium / high）。

**English** — rule-based classifier: is this text casual chat or a task, how hard is the task
(1–5), and which reasoning effort fits. Every verdict returns the signals that produced it, so a
wrong call is debuggable instead of mysterious. Pure function: no network, no model call, no hidden
state.

规则可解释：每个结论都会列出触发它的信号，判断错了能立刻看出是哪条规则的问题。

## 工具

| 工具 | 作用 |
|---|---|
| `route_text` | 给人看的分类报告 |
| `route_json` | 同一结论的紧凑 JSON，便于串联 |
| `route_policy` | 打印「类别 → 难度 → 推理强度」映射表 |

## 映射策略

| 类别 | 难度 | 推理强度 | 说明 |
|---|---|---|---|
| 聊天 | 0 | low | 闲聊不推理，直接自然回复 |
| 任务 | 1–2 | low | 单一机械小活，一次做对 |
| 任务 | 3 | medium | 多步骤或有约束，需要计划 |
| 任务 | 4–5 | high | 复杂/多约束/涉及代码与调试 |

## 判定依据

**聊天信号**（命中即倾向聊天）：短问候、道谢、应答、纯表情、寒暄式提问。

**任务信号**：请求动词（帮我/生成/修改/查询/安装/分析…）、交付物名词
（文件/代码/报告/表格/插件/方案…）、多步连接词（然后/接着/最后/并且…）。

**难度加分项**：长度 >150 / >600 字符、多步 ≥2、约束 ≥2、技术词或代码块、
交付物 ≥2、设计类词 ≥2（方案/架构/插件/重构…）。

## 用法示例

```
route_text { text: "在吗" }
→ kind: chat, difficulty 0, effort low

route_text { text: "帮我把 Excel 重复行删掉，然后按日期排序，最后导出 CSV，不要改原文件" }
→ kind: task, difficulty 3, effort medium
→ signals: task verbs 帮我/导出; deliverables 文件/excel; multi-step 然后/最后; constraints 不要
```

## 接入方式

这是**建议层**，不会强行改动会话的模型设置。调用方（agent 或 IM 桥）可以：

1. 收到消息 → `route_json`
2. 若 `kind=task` 且 `effort=high` → 切到高推理档位后再作答
3. 若 `kind=chat` → 直接低推理回复，省 token

## 边界

- 纯规则，不理解语义；反讽、隐含任务会判错（错误信息里有 signals，便于修正）。
- 中文为主，英文关键词只覆盖常见动词。
- 阈值写死在代码里，改 `TASK_VERBS` / `DELIVERABLES` / 难度加分项即可调。
