# Agent Mail POC v0.1 规格补充

## 状态

本文档记录了在第一版 thread/message/task 原型之后，对 POC 方向做出的澄清。

它用于补充现有设计文档。如果本文档与更早的 POC 文档冲突，那么在下一轮以 email 为中心的 POC 迭代中，以本文档为准。

## 目的

这个 POC 的目标是在尚未接入 SMTP 的前提下，让 Agent Mail 更接近真实的互联网邮件协作模型。

系统应当：

- 使用最小化、对齐 RFC 5322 的 email 结构
- 让 Central 继续作为持久化真相来源
- 让 Host 继续保持轻量的本地 runtime bridge
- 让 agents 只通过 Host MCP 工作
- 为未来接入真实外部邮件系统保留兼容空间

## 核心决策

1. Email 使用标准邮件概念，如 `from`、`to`、`cc`、`subject`、`message_id`、`in_reply_to` 和 `references`。
2. `from`、`to`、`cc` 使用结构化 address objects，而不是纯字符串。
3. `to` 和 `cc` 都建模为数组，但当前 POC 只允许一个主 `to` 收件人。
4. Threading 基于 `in_reply_to` 和 `references`，而不是 subject 匹配。
5. 如果一封入站邮件没有 reply linkage，Central 在 POC 中总是创建一个新 thread。
6. Task 的主归属是 email，辅归属是 thread。
7. Host 必须先向 Central 鉴权成功，才能暴露 MCP。
8. 每个 Host 在 POC 中有一个可 revoke 的长期 token。
9. 每个 mailbox 在任意时刻最多只能有一个 active session。
10. Agents 的首次注册由手动启动后通过 Host MCP 完成。
11. Host 每 10 秒轮询一次 unread mail，并唤醒空闲 agent。
12. POC 提示词要求 agent 每次 resume 只处理一封 email。

## 范围

### In Scope

- 标准化的内部 email model
- Central 对 email、delivery、thread、task、host、mailbox、agent profile 数据的持久化
- Host 对 Central 的 bootstrap auth
- Host MCP tools：agent 注册、邮件访问、read-state 变更、发信和 task 操作
- 显式 unread/read 处理
- 与 reply email 绑定的 task completion 校验
- 便于调试的 inspection 行为

### Out of Scope

- SMTP 收发
- 二进制附件上传
- 在线 hosts 之间的自动 mailbox 迁移
- 从未手动初始化过的 agents 的自动 bootstrap
- Markdown 邮件渲染

## 术语

### Address Object

使用与 RFC 5322 的 display-name + mailbox-address 语义对齐的结构化 address object：

```json
{
  "display_name": "Aster",
  "address": "pm.aster@agents.local"
}
```

`from` 是单个对象。

`to` 和 `cc` 是 address objects 数组。

### Email

Email 是系统中的规范化持久化邮件对象。

推荐字段：

- `email_id`：Central 内部主键
- `message_id`：RFC 风格的 message identifier
- `from`
- `to`
- `cc`
- `subject`
- `body_text`
- `raw_body`
- `in_reply_to`
- `references`
- `thread_id`
- `sent_at`
- `created_at`
- `updated_at`

规则：

- 对 POC 内部邮件，`message_id` 由 Central 生成。
- 未来接入外部邮件系统时，应保留外部原始 `message_id`。
- `references` 应存储为标准化的字符串数组。
- 规范字段名使用 `subject`，不要使用 `title`。
- `body_text` 和 `raw_body` 在 POC 中仅支持 plain text。

### Delivery

Unread/read 状态不挂在 email 本身上，而是挂在每个收件人的 delivery rows 上。

推荐字段：

- `delivery_id`
- `email_id`
- `recipient_address`
- `recipient_mailbox`
- `delivery_kind`
  - `to`
  - `cc`
- `read_status`
  - `unread`
  - `read`
- `read_at`
- `created_at`
- `updated_at`

规则：

- POC 使用 `delivery_id` 作为 `mark_read` 的主标识。
- debug/read-only inspection 不得修改 delivery read state。
- 只有正常 agent runtime 调用才允许修改 read state。

### Thread

Thread 是基于 reply linkage 构建的稳定对话容器。

推荐字段：

- `thread_id`
- `root_email_id`
- `root_message_id`
- `root_subject`
- `latest_email_id`
- `thread_status`
- `created_at`
- `updated_at`

规则：

- Thread 创建依赖 `in_reply_to` 和 `references`。
- 不允许只根据 subject 合并 threads。
- 两封 subject 相同但没有 reply linkage 的邮件必须拆成两个 threads。
- 后续 subject 变化不改变 thread 身份。
- UI 应展示首封邮件的 subject 作为 thread 标题。

### Task

Task 是主要挂在某封 email 上、并次要关联 thread 的执行记录。

推荐字段：

- `task_id`
- `thread_id`
- `trigger_email_id`
- `parent_task_id`
- `created_by_email_id`
- `assignee_mailbox`
- `status`
- `summary`
- `completed_by_email_id`
- `created_at`
- `updated_at`

规则：

- 如果 agent 先发送 delegation email，再创建 task，则 task 必须绑定那封 delegation email，而不是原始来信。
- 在 assignee 发送 reply email 之前，task 不得标记为 `done`。
- Central 必须验证：
  - `completed_by_email_id` 属于同一 thread
  - reply sender 与当前 task assignee 一致
  - reply email 的创建时间晚于 task 的创建时间

### Linked Resources

POC 不支持直接上传附件。Agents 只发送链接型资源。

推荐结构：

```json
{
  "url": "https://example.com/file.pdf",
  "title": "Spec Draft",
  "mime_type": "application/pdf",
  "size_bytes": 1024
}
```

它可以作为 `linked_resources[]` 或 `attachments[]` 存在于 email model 中。

## 系统职责

### Central

Central 是以下数据的真相来源：

- host records
- mailbox bindings
- agent profiles
- emails
- deliveries
- threads
- tasks
- linked resources
- auth tokens 及其 revoke 状态

Central 还负责：

- 生成内部 `message_id`
- 根据 reply linkage 计算 thread assignment
- 通过 `completed_by_email_id` 校验 task completion
- 强制执行“每个 mailbox 同时最多一个 active session”
- 当某 mailbox 仍绑定在健康的其他 Host 上时拒绝冲突注册
- 保证 debug/read-only inspection 不影响 read state

### Host

Host 是一个轻量的本地 runtime bridge。

Host 的职责：

- 用 bootstrap key 换取 host token
- 向 Central 注册自己
- 维持与 Central 的 heartbeat
- 只有在 Central auth/registration 成功后才暴露本地 MCP tools
- 通过 logs 和 `GET /mcp-config` 暴露 MCP 配置指令
- 每 10 秒轮询其管理 mailboxes 的 unread mail
- 当 mailbox 空闲且存在 unread mail 时 resume 对应 session
- 避免对已在运行中的 mailbox 再次 resume
- 对失败的 resume 做最多 3 次指数退避重试
- 当 token 无效或反复失败时，将 mailbox 标记为 unavailable

Host 不负责：

- 解释邮件内容的业务含义
- 自动 bootstrap 从未初始化过的新 agent
- 静默把邮件标记为已读

### Agent

Agent 的职责：

- 在第一次手动启动时完成 bootstrap，并接收 operator 提供的 profile data
- 在 workspace root 创建自己的 `AGENTS.md`
- 通过 Host MCP 注册自己，让 Host 再转发 profile 到 Central
- 通过 MCP 显式标记 deliveries 为已读
- 在 POC 中每次 resume 只处理一封 email
- 即使不需要创建 task，也要发送 receipt/reply email
- 在需要 delegation 或 execution tracking 时，通过 Host MCP 显式创建 task
- 在标记 task 完成之前，先发送 reply email

## Agent Profile Model

每个 agent 都有一份持久化 profile，包含：

- `name`
- `mailbox`
- `role`
- `responsibilities`
- `status`

规则：

- `responsibilities` 在 POC 中采用“基于 role 的固定职责模板”。
- POC discovery 只需要返回 `mailbox`、`name`、`role` 和 `status`。
- 如果 mailbox identity 或 name 变化，则视为一个新的 agent identity。
- 旧 identity 应变为 `retired`。
- `retired` mailbox 可以读取历史，但不能再发送新邮件。

## Runtime Flows

### 1. Host Bootstrap and Auth

1. Host 以预配置的 bootstrap key 启动。
2. Host 用 bootstrap key 换取一个长期、可 revoke 的 host token。
3. Host 向 Central 注册自身。
4. Host 开始每 5 秒向 Central 发送 heartbeat。
5. 只有在 auth 和 registration 成功后，Host 才允许暴露 MCP。
6. Host 输出 MCP setup instructions，并提供 `GET /mcp-config`。

规则：

- 如果 Host 连续 5 次错过或失败于 Central heartbeat，则可视为 offline
- 如果 token 校验失败或 token 被 revoke，Host 必须停止暴露 MCP，并将其管理 mailboxes 标记为 unavailable

### 2. First Manual Agent Startup

1. Operator 手动启动一个 agent session。
2. Operator 提供 profile 信息：
   - name
   - mailbox
   - role
   - responsibilities
3. Agent 写入本地 `AGENTS.md`。
4. Agent 调用 Host MCP 注册自己的 profile。
5. Host 将 profile 转发给 Central。
6. Central 将该 mailbox/profile 加入 discoverable agent list。

规则：

- 从未手动 bootstrap 过的 agents 不会注册
- 未注册 agents 不得接收邮件
- Host 不得自动 bootstrap 未知 agent

### 3. Incoming Email Ingestion

1. Central 接收来自 human、内部 agent 或未来外部 source 的新 email。
2. Central 根据 `in_reply_to` 和 `references` 决定归入哪个 thread，或创建新 thread。
3. Central 持久化 email。
4. Central 为每个 recipient 创建一条 delivery row。
5. Deliveries 初始状态为 `unread`。

规则：

- POC 当前只允许一个主 `to` recipient
- `cc` 会被保存，但当前不驱动 task logic

### 4. Host Polling and Resume

1. Host 每 10 秒向 Central 查询其管理 mailboxes 的 unread deliveries。
2. 如果某个 mailbox 有 unread deliveries，且当前不在运行，则 Host resume 该 mailbox 的 session。
3. 如果 mailbox 已在运行，则新 unread mail 留待下一轮处理。
4. 提示词要求 agent 每次 turn 只处理一封 unread delivery。
5. 当存在多封 unread deliveries 时，按最早接收时间 FIFO 处理。

规则：

- Host 驱动的是 `resume session`，不是启动新的 session fanout
- 一个 mailbox 同时只能有一个 active session
- 在 Host crash 后重复处理同一封邮件，在 POC 中可接受

### 5. Reading and Marking Read

1. Agent 通过 Host MCP 获取 unread mail。
2. Agent 自行决定下一步行为。
3. Agent 通过 MCP 显式调用 `mark_read(delivery_id)`。

规则：

- fetch 行为不得隐式标记已读
- debug/read-only fetches 不得触发 read state 变化

### 6. Delegation and Task Creation

1. Agent 通过 Host MCP 发送内部 delegation email。
2. Agent 通过 Host MCP 显式创建 task。
3. Host 将请求转发给 Central。
4. Central 创建与该 delegation email 和 thread 相关联的 task。

规则：

- email 是主协作对象
- task 是跟随 email 的结构化执行记录

### 7. Task Completion

1. Agent 先发送完成或进度 reply email。
2. Agent 再带上 `completed_by_email_id` 调用 task status update。
3. Central 校验完成规则。
4. 只有校验通过，Central 才能将 task 标记为 `done`。

规则：

- 先 reply，后改状态
- 不允许只改 task 状态而不发送 reply email

### 8. Debug and Human Intervention

POC 允许为了开发和排查而做 debug inspection。

规则：

- debug/read-only calls 必须显式打标
- debug reads 不得影响 unread state
- POC 中允许 debug 访问所有 mailboxes 和 threads
- debug access 应与正常 runtime traffic 分开记录日志

### 9. Failure and Recovery

如果一次 resume 失败：

1. Host 进行指数退避重试。
2. 连续 3 次失败后停止。
3. Host 将 mailbox 标记为 failed。
4. Human operator 重新登录 Host，并做手动清理后再恢复。

Mailbox binding 规则：

- 任意时刻，一个 mailbox 只能 active 在一个 Host 上
- POC 不支持自动 mailbox migration
- Host 重启后，mailbox binding 可能被重置，agent 必要时需要重新注册
- 如果另一个 Host 试图抢占仍然存活的 mailbox，Central 应拒绝，直到旧 binding 过期或被手动清理

## 最小 Central API 分组

确切 route names 后续仍可微调，但 POC 至少需要这些 Central 能力：

- Host bootstrap auth
- Host registration
- Host heartbeat
- mailbox binding / unbinding
- agent profile registration 与 discovery
- create/send email
- 列出某 mailbox 的 unread deliveries
- mark delivery read
- 获取 thread detail
- 获取 email detail
- create task
- 使用 `completed_by_email_id` 更新 task status
- debug/read-only inspection APIs

## 最小 Host MCP Surface

确切 tool names 后续仍可微调，但 POC 至少需要这些 Host MCP 能力：

- register agent profile
- get runtime context
- get unread deliveries
- get email by `email_id`
- get thread by `thread_id`
- mark delivery read
- send email
- create task
- update task status
- list agents

Host 还应暴露这些非 MCP 的薄 API：

- `GET /health`
- `GET /status`
- `GET /mcp-config`

## Idempotency

POC 要求对有副作用的操作提供 idempotency 保护。

至少包括：

- 发送 email 必须幂等
- 创建 task 必须幂等

Central 应作为幂等去重行为的规范实现方。确切的请求握手和参数命名可以在 API contract 阶段继续细化。

## POC 约束

- `to` 虽然建模为数组，但 POC 应强制只有一个主 recipient
- `cc` 在模型中存在，但当前不参与 task routing
- 首版 POC 不实现 draft 持久化，只要求 send 流程可用
- 不支持二进制附件上传，只支持 linked resources
- 不允许自动完成首次 agent bootstrap
- 不支持自动 mailbox migration
- 不允许 subject-only thread merge

## 后续设计工作

本文档已经足够支撑下一轮设计工作：

- data model 修订
- Central API contract 修订
- Host MCP contract 修订
- “每次 resume 只处理一封 email”的 prompt 修订
- implementation plan 更新
