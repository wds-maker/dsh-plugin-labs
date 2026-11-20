# DSH Plugin Labs

给 [DeepSeek Harness](https://github.com/deepseek-ai) 写的一批小插件，源码公开，**主要是为了收意见**：
规则合不合理、边界有没有漏、接口设计对不对，都欢迎直接开 issue 讨论。

**English summary** — experimental [DeepSeek Harness](https://github.com/deepseek-ai) plugins, published
as-is for community review. Three small Cordis plugins: auto-start a local ComfyUI server, carry a
compressed recap of previous sessions into a new one, and rule-classify "chat vs task" into a
reasoning-effort hint. No npm publish, no stable API promise — read
[Known limits](#known-limits) before you install.

> **状态：实验性。** 只在这台开发机上验证过，没做跨版本兼容承诺。接口可能变，出问题请开 issue。

## 三个插件

| 包 | 一句话 | 依赖外部服务？ |
|---|---|---|
| [`dsh-comfyui-autostart`](packages/dsh-comfyui-autostart) | DSH 启动时顺手把本地 ComfyUI 拉起来，省掉"connection refused" | 需要本地 ComfyUI 安装 |
| [`dsh-session-recall`](packages/dsh-session-recall) | 新会话开始时，把同工作区上一次在干什么压缩成几百字注入 | 无（不调模型） |
| [`dsh-reasoning-router`](packages/dsh-reasoning-router) | 判断一段话是闲聊还是任务、难度几分、该用哪档推理 | 无（纯规则） |

三个插件的共同点：**绝不阻断 DSH 启动**，任何异常只记日志；核心逻辑都是纯函数，能直接 `node --test` 跑。

## 安装

DSH 插件通过 profile 的 `dependencies` + `dsh.profile.bundles` 加载，包内的 `cordis.patch.yml`
负责把插件节点插进配置树。

```jsonc
// <DSH_HOME>/profiles/<profile>/package.json
{
  "dependencies": {
    "dsh-comfyui-autostart": "github:wds-maker/dsh-plugin-labs#path:packages/dsh-comfyui-autostart"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-comfyui-autostart"]
    }
  }
}
```

本地开发时也可以直接指目录：

```jsonc
"dsh-session-recall": "file:D:/path/to/dsh-plugin-labs/packages/dsh-session-recall"
```

每个插件的配置项写在它自己的 `cordis.patch.yml` 里，装完在那个文件里改即可（详见各包 README）。

## 测试

```bash
npm install          # 只为 workspace 链接，插件本身零运行时依赖
npm test             # 每个包跑 node --test
```

`dsh-comfyui-autostart` 另有一个**真启服务**的端到端测试，默认跳过：

```bash
cd packages/dsh-comfyui-autostart
COMFYUI_E2E=1 node integration/autostart.integration.mjs
```

CI 在 Node 20 / 22 / 24 上跑单元测试（Ubuntu），不跑端到端。

## 目录

```
packages/
  dsh-comfyui-autostart/   boot-time ComfyUI launcher
  dsh-session-recall/      cross-session recap injector
  dsh-reasoning-router/    chat/task difficulty classifier
```

## Known limits

- **只在 Windows 上实测**。`dsh-comfyui-autostart` 的默认路径是 `D:/ComfyUI/...`，别的机器必须改
  `cordis.patch.yml`。两个无外部依赖的插件理论上跨平台，但没有 Linux/macOS 实测记录。
- **`dsh-session-recall` 是抽取式的**，不做语义归纳；长会话只保留首尾，且依赖 `ctx.sessionQuery` 服务。
- **`dsh-reasoning-router` 是规则不是模型**，反讽、隐含任务会判错；好在每个结论都回传 signals，判错能定位。
- 没发 npm，`private: true` 保留着，避免误发布。

## 反馈

- 规则判错：请贴 `route_text` 的完整输出（signals 比结论更有用）
- 想加的 hook/配置项：直接开 issue 说清使用场景
- 安全/隐私问题：不要公开贴 token 或会话内容，脱敏后再贴

## License

MIT
