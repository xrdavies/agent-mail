# Agent Host

Agent Host 是一个 machine-local daemon，负责 mailbox 注册、本地 session registry、heartbeat 和 runtime status。

它还负责：

- 在 `/mcp` 暴露本地 MCP
- 检测 mailbox 的待处理工作
- 决定使用 `codex exec` 还是 `codex exec resume`
- 持久化 session summary 和 `last-processed-message`

## 本地运行

1. 复制 env 模板：

   ```bash
   cp apps/host/.env.example apps/host/.env
   ```

2. 调整 `apps/host/host.example.toml`，或把 `HOST_CONFIG_PATH` 指向其他 TOML 文件。

3. 启动 daemon：

   ```bash
   pnpm dev:host
   ```

4. 将 Host MCP endpoint 注册到 Codex：

   ```bash
   codex mcp add agent-mail-host --url http://localhost:8788/mcp
   ```

5. 检查本地暴露的接口：

   - `GET /health`
   - `GET /status`
   - `/mcp`

## 运行时行为

当 daemon 运行时，它会周期性执行以下动作：

1. 刷新 machine 和 session heartbeat
2. 检查本地 mailboxes 是否有待处理任务
3. 如果某个 mailbox 没有 active session，则运行 `codex exec`
4. 如果某个 mailbox 已有 active session，则运行 `codex exec resume <session_id>`

对于由 Host 管理的 turns，MCP endpoint 会自动注入到 Codex 命令行中。只有当你想自己手动启动一个交互式 Codex session，并通过同一个本地 MCP bridge 进行 bootstrap 时，才需要手动执行 `codex mcp add`。
