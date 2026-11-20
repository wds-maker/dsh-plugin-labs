# dsh-comfyui-autostart

DSH 启动时顺手把本地 ComfyUI 服务拉起来。没有它，`comfyui-bridge` 第一次请求通常以
`ECONNREFUSED` 收场——因为没人保证服务在跑。

**English** — starts a local ComfyUI server as a side effect of DSH boot. It probes the port first
(never spawns a second server), spawns a detached child, and swallows every error so a broken
ComfyUI install can never take DSH down.

## 行为

`apply()` 在 bundle 树启动时执行一次：

1. 检查 `python` 和 `main.py` 是否存在，不存在就记日志返回
2. 探测 `host:port` 是否已监听，已监听就什么都不做
3. 未监听 → `spawn` 一个 **detached** 子进程跑 `main.py --listen <host> --port <port>`，日志追加到 `logFile`
4. 结果写进 `stateFile`（JSON：`{ phase, started, reason, pid, at }`）

子进程是 detached 的，所以 **DSH 退出后 ComfyUI 继续跑**（模型还占着显存）。下次启动只会探测到端口已开，
不会重复拉起。

## 配置

默认值写死在 `lib/index.js` 的 `DEFAULTS`，覆盖方式是在 profile 的 `cordis.patch.yml`（或包内的）改：

```yaml
- id: comfyui-autostart
  name: dsh-comfyui-autostart
  config:
    python: D:/ComfyUI/.venv/Scripts/python.exe  # ← 换成你的解释器
    script: D:/ComfyUI/main.py                    # ← 换成你的 main.py
    cwd: D:/ComfyUI
    host: 127.0.0.1
    port: 8188
    logFile: D:/ComfyUI/comfyui-autostart.log
    stateFile: D:/ComfyUI/comfyui-autostart.state.json
```

> **默认值是 Windows + `D:/ComfyUI` 的假设。** Linux/macOS 或者装在别处的同学，这 7 个字段都得改；
> 只改 `python` 不改 `script`/`cwd` 会得到 `main.py not found`。

## 测试

```bash
node --test                                  # 单元测试：三个提前返回分支 + 导出面
COMFYUI_E2E=1 node integration/autostart.integration.mjs   # 真拉起服务（需要可用安装）
```

单元测试用临时目录和监听中的 socket 模拟，不碰真实 ComfyUI。

## 已知边界

- **只探 TCP 端口，不做 HTTP 健康检查**：端口开了就算"起来了"，正在加载模型的 ComfyUI 也算。
- 不做退出管理：没有"DSH 关掉就杀 ComfyUI"的逻辑（detached 是有意为之）。
- 不重试：spawn 失败就只写一次 state，下次启动再试。
- 抢占端口、多实例冲突不在处理范围内。
