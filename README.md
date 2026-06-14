# Agent Mail

Agent Mail 正在从以文档为主的基线，重建为一个遵循 `docs/` 中 POC 架构的 TypeScript monorepo。

当前面向 email 的 POC 澄清文档位于 [docs/poc-v0.1-email-central-host.md](/Users/m4002/Projects/agent-mail/docs/poc-v0.1-email-central-host.md:1)。

## 当前工作区

- `apps/central`：基于 Hono 的 control-plane service，使用 Drizzle/Postgres 持久化
- `apps/host`：machine-local daemon，负责注册、本地 session registry、heartbeat、本地 MCP，以及自动 `codex exec/resume`
- `packages/shared`：共享 enums、payload schemas 和 response contracts
- `apps/web`：面向 human/operator 的 React/Vite workbench，用于查看 threads、tasks、hosts 和 sessions

## 本地开发

目前最快的脚本化启动方式是：

```bash
pnpm local:start
pnpm local:status
```

如果需要一个全新的本地数据库并清空 Host session state：

```bash
pnpm local:start -- --fresh
```

1. 启动 PostgreSQL：

   ```bash
   docker compose up -d
   ```

2. 准备 Central 和 Host 的 env 文件：

   ```bash
   cp apps/central/.env.example apps/central/.env
   cp apps/host/.env.example apps/host/.env
   ```

3. 生成并应用 migrations：

   ```bash
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/agent_mail pnpm db:generate
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/agent_mail pnpm db:migrate
   ```

4. 启动 Central service：

   ```bash
   pnpm dev:central
   ```

5. 在第二个终端启动 Host daemon：

   ```bash
   pnpm dev:host
   ```

6. 在第三个终端启动 operator Web UI：

   ```bash
   pnpm dev:web
   ```

7. 如果你希望手动启动的 Codex session 走同一个本地 MCP bridge，需要把 Host MCP endpoint 注册到 Codex：

   ```bash
   codex mcp add agent-mail-host --url http://localhost:8788/mcp
   ```

当 Host daemon 为待处理 mailbox work 启动 `codex exec` 或 `codex exec resume` 时，也会自动注入这个 MCP endpoint。

8. 运行校验：

   ```bash
   pnpm test
   pnpm build
   ```

9. 运行正式的 end-to-end validation 流程：

   ```bash
   pnpm validate:phase10
   ```

`validate:phase10` 现在是 implementation plan 的默认 proof path。它会准备临时验证栈，驱动 Phase 10 中的 mailbox/session 场景，验证 operator Web surface，并输出最终 JSON report。

如果你希望保留临时 workspaces、logs 和 report 以便调试，请使用：

```bash
pnpm validate:phase10 -- --keep-temp
```
