# dsh-session-recall

新会话开始后，自动把**同一个工作区**里最近几次会话整理成一份压缩摘要，注入新会话，
这样不用从头再讲一遍"上次做到哪"。

**English** — when a session starts, reads the most recent sessions that ran in the **same
workspace**, extracts goal / tools / last answer, compresses them into a few hundred characters and
injects that as a user-role context message. No model call: the compression is deterministic, so it
costs zero tokens and cannot hallucinate. It is an index, not prose.

> 它不调用模型，纯规则抽取：**零 token 成本、不会编造**。产出的是一份索引，不是散文。

## 它做什么

会话启动时（`agent/session-start`，且不是子代理、不是压缩触发的会话）：

1. 通过 `ctx.sessionQuery` 取出本工作区最近的会话（默认 3 个，跳过当前会话本身）
2. 从每个会话的事件流里抽取：目标（第一条用户消息）、最后追问、轮次、用到的工具、结论（最后一条助手消息）
3. 按字符预算（默认 1600）压缩成 markdown
4. 以 user 角色消息注入新会话
5. 同时落盘到工作区 `.dshrecall/last.md` 和 `.dshrecall/recall-<时间>.md`

## 和 dsh-openwolf 的分工

| | dsh-openwolf | dsh-session-recall |
|---|---|---|
| 内容 | 人工维护的 STATUS / cerebrum / buglog | **自动**抽取的历史会话事实 |
| 来源 | `.dshwolf/` 文件 | 会话事件流（sessionQuery） |
| 适合 | 长期偏好、禁忌、项目约定 | "上次干了什么、结论是什么" |

两个可以同时装：一个管"长期规矩"，一个管"上次的现场"。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖：

```yaml
- id: session-recall
  config:
    maxSessions: 3      # 回溯几个历史会话
    budgetChars: 1600   # 注入文本的字符预算
    timeoutMs: 8000     # 超时就直接放弃（不阻塞会话启动）
    includeTools: true  # 是否列出用到的工具名
```

## 安全与失败处理

- 任何异常只记日志，**不会阻断会话启动**
- 硬超时：超过 `timeoutMs` 直接放弃本轮注入
- 只读会话日志，不写会话、不改配置
- 子代理会话（`delegationDepth > 0`）不注入，避免噪音

## 已知限制

- 摘要是**抽取式**的，不做语义归纳；长会话只保留首尾
- 依赖 `ctx.sessionQuery` 服务；拿不到服务时静默跳过
- 只读最近 N 个会话，更早的历史需要 `session_search`
- 注入内容可能和 openwolf 的摘要部分重叠（两套记忆体系，注意别打架）

## 卸载

从 profile 的 `dsh.profile.bundles` 移除 `dsh-session-recall` 并重启。
