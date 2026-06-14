# Agent Mail 实现计划

## 目的

本文档定义当前 Agent Mail email-oriented POC 的实现计划草案。

它的作用是：

- 把现有架构和接口规范转成可执行的工程阶段
- 明确先做什么、后做什么
- 限制实现顺序，避免实现时重新发散架构
- 让 `Central`、`Host`、`MCP`、prompt、数据模型能够按一致顺序落地

本文档建立在以下文档之上：

- [poc-v0.1-email-central-host.md](./poc-v0.1-email-central-host.md)
- [data-model.md](./data-model.md)
- [api-contract.md](./api-contract.md)
- [prompt-specification.md](./prompt-specification.md)
- [tech-stack.md](./tech-stack.md)

## 当前实现目标

当前 POC 要证明的是：

1. `mailbox -> host` 归属关系可以稳定成立
2. agent 首次手动启动可以完成本地身份建立与注册
3. Host 能按最早未读邮件唤醒对应 mailbox
4. agent 能通过 Host MCP 处理一封未读邮件
5. `Aster -> Coda` 这种委派链路可以跑通
6. `requiresArtifact=true` 的任务可以在完成时携带交付物元数据闭环

## 计划原则

1. 先锁最小技术路线，再开始实现。
2. 技术路线锁定后，再冻结规格与接口面。
3. 先做 `Central` 数据与接口，再做 `Host` 和 `MCP`。
4. 先打通一条最小闭环，再补调试与观测能力。
5. 先让一封邮件跑通，再扩大到更多角色和更多边界场景。
6. `Web` 在第一阶段明确后置，不阻塞主链路实现。
7. 所有实现都应直接遵循当前文档，不引入与文档冲突的实现路径。

## 实施阶段总览

建议按以下阶段推进：

- P0：最小技术路线锁定
- P1：规格冻结
- P2：仓库骨架建立
- P3：Contracts 层
- P4：Central 数据层
- P5：Central HTTP API
- P6：Host 本地服务
- P7：Host MCP tools
- P8：Host 调度与 `resume`
- P9：端到端验证

## P0：最小技术路线锁定

### 目标

确认开始实现所需的最小技术集合，避免边写边换底层。

### 必须锁定的内容

- `Node.js 24`
- `TypeScript`
- `pnpm workspace`
- `Hono`
- `Zod`
- `PostgreSQL`
- `Drizzle ORM`
- `@modelcontextprotocol/sdk`
- `SQLite` 作为 `Host` 本地状态存储
- `React`
- `Vite`
- `Tailwind CSS`
- `shadcn/ui`
- `TanStack Query`
- `git`
- `gh`
- `Docker Compose`
- `Web` 第一阶段后置，不作为主链路阻塞项

### 产物

- 一份最小技术栈确认
- 一份第一阶段不阻塞项清单

### 验收条件

- 后续阶段不再变更主要 runtime、数据库与主框架
- `Web` 被明确标记为第一阶段后置

## P1：规格冻结

### 目标

冻结当前 POC 的核心设计，停止在实现前继续变化接口面。

### 必须冻结的内容

- `Central API` 18 个
- `Host MCP tools` 12 个
- `mailbox -> host` 是核心归属关系
- `MailboxRuntime` 只是 `Host` 上报的运行时快照
- 首次启动只做 `bootstrap_agent`
- `resume` 每轮只处理一封最早未读邮件
- `artifacts` 跟随 `PATCH /tasks/:task_id/status` 一并提交

### 产物

- 已确认的文档集合
- 不再争论的接口清单

### 验收条件

- `poc-v0.1`、`data-model`、`api-contract`、`prompt-specification` 四份核心文档对齐
- `PROMPT_ASTER.md`、`PROMPT_CODA.md` 与 `MCP tools` 命名一致

## P2：仓库骨架建立

### 目标

搭建当前实现所需的代码仓库骨架。

### 任务

- 建立 `.gitignore`
- 建立 workspace 基础结构
- 建立：
  - `apps/central`
  - `apps/host`
  - `packages/contracts`
- 建立基础 `tsconfig`
- 建立基础 package manager 配置
- 建立最小 build / test 脚手架
- 不在这一阶段实现 `Web`

### 产物

- 一个可安装依赖、可编译的空骨架工程

### 验收条件

- monorepo 结构建立完成
- 基础构建可运行
- `Central + Host + contracts` 三块最小骨架可用

## P3：Contracts 层

### 目标

在真正写 handler 之前，先把共享类型和 schema 定义好。

### 必须先定义的对象

- `AddressObject`
- `Host`
- `HostToken`
- `AgentProfile`
- `MailboxBinding`
- `MailboxRuntime`
- `Email`
- `Delivery`
- `Thread`
- `Task`
- `LinkedResource`
- `Artifact`

### 必须先定义的请求/响应 contract

#### Central API

- Host auth / register / heartbeat
- agents/register / agents / agents/:mailbox
- emails/send
- mailboxes/:mailbox/deliveries
- mailboxes/:mailbox/unread-deliveries
- mailboxes/:mailbox/unread-deliveries/oldest
- deliveries/:delivery_id/read
- emails/:email_id
- threads/:thread_id
- tasks
- tasks/:task_id/status
- idempotency-keys/issue

#### Host MCP

- `bootstrap_agent`
- `get_oldest_unread_delivery`
- `get_delivery`
- `get_email`
- `get_thread`
- `mark_delivery_read`
- `send_email`
- `create_task`
- `get_task`
- `list_tasks`
- `update_task_status`
- `list_agents`

### 产物

- `contracts` 层的 TS types
- `contracts` 层的 Zod schemas

### 验收条件

- `Central` 和 `Host` 两边都引用同一套 contract 定义

## P4：Central 数据层

### 目标

先把数据库真相层落实，再写 API。

### 实施顺序

1. `Host`
2. `HostToken`
3. `AgentProfile`
4. `MailboxBinding`
5. `MailboxRuntime`
6. `Thread`
7. `Email`
8. `Delivery`
9. `Task`
10. `LinkedResource`
11. `Artifact`

### 关键约束

- 一个 mailbox 同时只能 active 在一个 Host
- thread 通过 `in_reply_to/references` 归并
- `Delivery` 维护 unread/read
- `Task.done` 时校验 `completed_by_email_id`
- `requiresArtifact=true` 时，`done` 必须带 `artifacts`

### 产物

- schema
- migrations
- 数据访问层

### 验收条件

- 可以通过测试构造并读取全部核心对象

## P5：Central HTTP API

### 目标

实现 18 个正式 `Central API`。

### 推荐顺序

#### 第一批：Host 与身份主链路

- `GET /api/v1/health`
- `POST /api/v1/host-auth/exchange`
- `POST /api/v1/hosts/register`
- `POST /api/v1/hosts/:host_id/heartbeat`
- `POST /api/v1/agents/register`
- `GET /api/v1/agents`
- `GET /api/v1/agents/:mailbox`

#### 第二批：邮件主链路

- `POST /api/v1/emails/send`
- `GET /api/v1/mailboxes/:mailbox/unread-deliveries`
- `GET /api/v1/mailboxes/:mailbox/unread-deliveries/oldest`
- `POST /api/v1/deliveries/:delivery_id/read`
- `GET /api/v1/emails/:email_id`
- `GET /api/v1/threads/:thread_id`

#### 第三批：Task 主链路

- `POST /api/v1/tasks`
- `GET /api/v1/tasks`
- `PATCH /api/v1/tasks/:task_id/status`

#### 第四批：辅助与调试

- `GET /api/v1/mailboxes/:mailbox/deliveries`
- `POST /api/v1/idempotency-keys/issue`

### 产物

- 可运行的 `Central` 服务
- API 测试

### 验收条件

- `Host` 能通过这些 API 完成完整业务主链路

## P6：Host 本地服务

### 目标

先实现一个最薄的 `Host`，具备认证、状态上报和本地接口能力。

### 任务

- 读取本地 Host 配置
- bootstrap key -> host token
- `hosts/register`
- `hosts/:host_id/heartbeat`
- mailbox roster 管理
- `GET /health`
- `GET /status`
- `GET /mcp-config`

### 产物

- 一个能鉴权、能上报、能暴露本地状态的 Host 进程

### 验收条件

- `Host` 启动后可在 `Central` 中看到自身和当前 mailbox 归属

## P7：Host MCP tools

### 目标

把 12 个 `MCP tools` 完整实现出来。

### 推荐顺序

#### 首次启动

- `bootstrap_agent`

#### 邮件处理

- `get_oldest_unread_delivery`
- `get_delivery`
- `get_email`
- `get_thread`
- `mark_delivery_read`
- `send_email`

#### Task

- `create_task`
- `get_task`
- `list_tasks`
- `update_task_status`

#### Agent 发现

- `list_agents`

### 产物

- agent 能通过 MCP 走完整工作流

### 验收条件

- 不需要 agent 直接访问 `Central API`

## P8：Host 调度与 `resume`

### 目标

实现真正的自动工作流：轮询、挑选最早未读邮件、唤醒 agent。

### 任务

1. 每 10 秒轮询 `unread-deliveries/oldest`
2. 找出当前最早未读邮件
3. 如果 mailbox 空闲，则 `resume`
4. 如果 mailbox 忙，则等待下一轮
5. 失败做指数退避
6. 三次失败后标记 mailbox failed
7. 在 Host heartbeat 中上报 `MailboxRuntime`

### 产物

- 自动 resume 主链路

### 验收条件

- 无需人工手动挑邮件
- Host 能稳定唤醒正确 mailbox

## P9：端到端验证

### 目标

证明系统最小闭环已经成立。

### 最少验证场景

1. `Aster` 首次启动成功
2. `Coda` 首次启动成功
3. human 发邮件给 `Aster`
4. Host 唤醒 `Aster`
5. `Aster` 发 delegation email 并创建 task 给 `Coda`
6. Host 唤醒 `Coda`
7. `Coda` 回复并完成 task
8. `Aster` 再次被唤醒并汇总回复 human
9. `requiresArtifact=true` 的 task 在 `done` 时携带 `artifacts` 完成闭环

### 产物

- 一套可运行的 E2E 验证流程

### 验收条件

- `Central API`、`Host MCP`、prompt 行为都符合文档

## 实现优先级建议

### P0：必须最先完成

- 最小技术路线锁定
- 规格冻结
- 仓库骨架建立

### P1：必须先打通的主链路

- Contracts
- Central 数据层
- Central HTTP API 第一批和第二批
- Host 本地服务
- Host MCP 邮件主链路

### P2：闭环执行能力

- Task 主链路
- `requiresArtifact` 校验
- Host 调度与 `resume`

### P3：验证与补强

- E2E 场景
- 调试与观测能力
- `idempotency-keys/issue`
- 通用 deliveries 查询

## 最终目标

完成该实现计划后，仓库应形成一套与当前规范完全一致的新代码基线：

- `Central` 是唯一业务状态中心
- `Host` 是轻量执行协调器
- `MCP` 是 agent 唯一运行时入口
- `Aster` / `Coda` 能按文档中的 prompt 和工具链路协同工作
