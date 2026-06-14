# Agent Mail

Agent Mail 现在包含一套按文档实现的 email-oriented POC 代码基线：

- `packages/contracts`
  - Central API、Host thin HTTP、Host MCP 的共享 Zod schema 与类型
- `apps/central`
  - Hono + Drizzle + PostgreSQL 的控制面服务
- `apps/host`
  - Hono + MCP SDK + SQLite 的本地 Host runtime
- `docs/*`
  - 架构、数据模型、API、prompt、实现计划与技术栈说明

## 当前能力

- Host bootstrap key -> Central long-lived host token 交换
- Host register / heartbeat
- Agent profile 注册与 mailbox binding
- Email / Delivery / Thread / Task 主链路
- Host MCP 12 个 tools
- Host 本地 SQLite 状态与自动轮询 `resume`
- Drizzle migration
- Central 关键约束测试

## 数据库边界

- `PostgreSQL` 是 Central 的实际运行时数据库，开发和本地联调也使用它。
- `PGlite` 只用于 `apps/central/test` 下的测试执行，用来无外部依赖地跑 service 级验证。
- 这不是运行时数据库切换，生产与本地主链路仍然基于 PostgreSQL。

## 目录结构

```text
apps/
  central/
  host/
packages/
  contracts/
docs/
```

## 本地启动

1. 安装依赖：

```bash
pnpm install
```

2. 启动 PostgreSQL：

```bash
docker compose up -d postgres
```

3. 配置环境变量：

- Central 参考 [apps/central/.env.example](./apps/central/.env.example)
- Host 参考 [apps/host/.env.example](./apps/host/.env.example)

4. 生成并执行 migration：

```bash
pnpm db:generate
pnpm db:migrate
```

5. 启动 Central：

```bash
pnpm dev:central
```

6. 启动 Host：

```bash
pnpm dev:host
```

7. 查看 Host MCP 配置：

```bash
curl http://127.0.0.1:8788/mcp-config
```

## 本地联调脚本

```bash
pnpm local:start -- --fresh
pnpm local:status
pnpm local:bootstrap
pnpm e2e:smoke
pnpm local:stop
```

- `local:start`
  - 创建/复用 mailbox worktree，启动 Postgres、Central、Host，并在 `--fresh` 下重置数据库与 Host 本地状态。
- `local:status`
  - 输出 Postgres / Central / Host / mailbox runtime 的当前状态。
- `local:bootstrap`
  - 为 `pm.aster@agents.local` 和 `backend.coda@agents.local` 跑真实首次启动，让各自会话写入 `AGENTS.md` 并调用 `bootstrap_agent`。
- `e2e:smoke`
  - 种入一封 `human_inbound`，等待 Host 自动轮询、Aster 委派、Coda 产出 artifact 并关闭 task、Aster 最终回 human。
- `local:stop`
  - 停掉 Host / Central；默认同时停掉本地 Postgres，可用 `-- --keep-postgres` 保留数据库。

更正式的步骤和排障说明见 [docs/runbook-local-smoke.md](./docs/runbook-local-smoke.md)。

## 验证

```bash
pnpm typecheck
pnpm build
pnpm test
```

## 规范文档

- [docs/poc-v0.1-email-central-host.md](./docs/poc-v0.1-email-central-host.md)
- [docs/data-model.md](./docs/data-model.md)
- [docs/api-contract.md](./docs/api-contract.md)
- [docs/prompt-specification.md](./docs/prompt-specification.md)
- [docs/implementation-plan.md](./docs/implementation-plan.md)
- [docs/tech-stack.md](./docs/tech-stack.md)
- [PROMPT_ASTER.md](./PROMPT_ASTER.md)
- [PROMPT_CODA.md](./PROMPT_CODA.md)
