# Agent Mail 技术栈确认

## 目的

本文档用于锁定当前 Agent Mail email-oriented POC 的**最小技术路线**。

它的作用不是追求“理想化全栈说明”，而是回答一个更务实的问题：

- 为了开始实现当前 POC，哪些技术选型必须先确认？
- 哪些选型可以后置，不应该阻塞第一轮实现？
- 哪些选型已经是正式基线，后续不应随意变更？

本文档建立在以下文档之上：

- [poc-v0.1-email-central-host.md](./poc-v0.1-email-central-host.md)
- [data-model.md](./data-model.md)
- [api-contract.md](./api-contract.md)
- [prompt-specification.md](./prompt-specification.md)
- [implementation-plan.md](./implementation-plan.md)

## 选型原则

1. 优先选择**足够支撑当前 POC**的最小集合，而不是提前为未来规模优化。
2. 尽量让 `Central`、`Host`、contracts 层使用同一种语言和主要 runtime。
3. 优先选择对本地开发、私有环境和小团队调试友好的工具。
4. 先锁最小技术路线，再开展实现与细化接口。
5. 第一阶段不让 `Web` 阻塞主链路实现。
6. 当前文档中的技术路线就是正式基线，后续实现应直接遵循。

## 已锁定的最小技术栈

以下选型视为当前 POC 的正式基线。

### 1. Runtime 与主语言

- `Node.js 24`
- `TypeScript`

原因：

- `Central` 和 `Host` 继续共享同一 runtime 与语言，降低心智负担
- `TypeScript` 便于共享 API schema、MCP contract 与类型定义
- `Node.js 24` 已是当前项目和环境中最自然的基线

### 2. Monorepo 与包管理

- `pnpm`
- `pnpm workspace`

原因：

- 当前系统天然包含多个边界：`Central`、`Host`、contracts
- `pnpm workspace` 足够支撑当前规模
- 不需要引入更复杂的 monorepo orchestration 工具

### 3. Central

- HTTP framework：`Hono`
- Validation：`Zod`
- Persistence：`PostgreSQL`
- ORM / schema / migration：`Drizzle ORM`

原因：

- `Hono` 足以支撑 `Central HTTP API` 18 个接口
- `Zod` 适合做 request/response schema 与 contracts 对齐
- `PostgreSQL` 适合作为 POC 的关系型状态中心
- `Drizzle ORM` 足够轻量，且便于贴近 `TypeScript` 定义 schema

### 4. Host

- `Node.js 24`
- `TypeScript`
- `Hono`（用于本地 thin HTTP API）
- `@modelcontextprotocol/sdk`

原因：

- `Host` 是本地 daemon，不需要单独技术栈
- `Hono` 足够暴露 `/health`、`/status`、`/mcp-config`
- `@modelcontextprotocol/sdk` 是实现 `Host MCP tools` 的自然选择

### 5. Contracts 层

- `TypeScript`
- `Zod`

原因：

- 当前系统的稳定核心在于：
  - `Central API` contract
  - `Host MCP` contract
  - 数据模型 schema
- `contracts` 层应成为 `Central` 和 `Host` 之间的共同基础

### 6. Web

当前 POC 的 **Web 技术栈已经锁定**，但 **Web 实现在第一阶段后置**。

锁定基线为：

- `React`
- `Vite`
- `Tailwind CSS`
- `shadcn/ui`
- `TanStack Query`

说明：

- 这表示技术路线已确认，但不要求在第一轮主链路里先实现 Web
- 当前最小闭环首先仍应打通 `Central + Host + MCP`
- Web 不应阻塞第一轮主流程实现
- 是否引入 client-side router，仍可在恢复 Web 代码时按页面复杂度决定

### 7. Git 与 GitHub 操作

- `git`
- `gh`
- `HTTPS` remotes

原因：

- repository output 最终仍然落在本地 repo / `GitHub`
- 当前项目已经明确使用 `gh auth`
- 当 `git push` 失败时，首先检查 `gh auth status`

### 8. 本地数据库与支撑环境

- `Docker Compose`

原因：

- 用于本地 `PostgreSQL`
- 对当前 POC 来说已经足够
- 不需要引入更复杂的编排系统

### 9. 测试

- `Vitest`

第一轮建议：

- `Central` 与 `Host` 先补单元 / 集成测试
- E2E 可以在后续阶段再决定是否恢复浏览器或系统级验证工具

如果后续实现 Web 并需要浏览器级验证，可再补：

- `Playwright`

## 当前不锁定或明确后置的选型

以下内容当前不应阻塞实现：

### Web UI 细节

- 是否使用 client-side router
- 是否引入复杂状态管理

理由：

- 当前主闭环不依赖 Web
- 应先打通后台系统

### Host 本地状态存储

当前 `Host` 本地状态存储正式锁定为：

- `SQLite`

原因：

- 比 JSON file 更适合表达 mailbox runtime、失败重试状态与本地运行时快照
- 仍保持足够轻量，便于后续切换到其他数据库实现
- 对当前 POC 来说复杂度和收益平衡更合适

### 观测与日志体系

当前只要求：

- 结构化日志
- 基本可读的错误输出

不需要一开始就引入：

- OpenTelemetry
- ELK
- Prometheus
- Grafana

### 队列和调度基础设施

当前明确不需要：

- `Redis`
- `Kafka`
- `RabbitMQ`
- 独立 job queue

原因：

- 当前 POC 的调度策略足够简单：
  - Host 每 10 秒轮询
  - 一次处理一封最早未读邮件

### 部署编排

当前不锁定：

- Kubernetes
- Nomad
- systemd 配套策略
- 云厂商部署细节

这些都应后置。

## 推荐的最小目录结构

建议的最小目录结构为：

```text
apps/
  central/
  host/
packages/
  contracts/
docs/
```

说明：

- `Web` 可在后续阶段再补回
- 第一阶段只保留 `Central`、`Host`、`contracts` 三块最小结构

## 与实现计划的对应关系

### P0 必须立即锁定的

- `Node.js 24`
- `TypeScript`
- `pnpm workspace`
- `Hono`
- `Zod`
- `PostgreSQL`
- `Drizzle ORM`
- `@modelcontextprotocol/sdk`
- `SQLite`
- `git`
- `gh`
- `Docker Compose`

### 可以到后续阶段再决定的

- Web 的 routing 方案
- 浏览器级测试工具
- 更复杂的日志与观测体系

## 最终规则

后续实现应直接以本文档锁定的技术路线为准，不应在没有明确决策的情况下随意替换主要 runtime、数据库、框架或 contract 方案。
