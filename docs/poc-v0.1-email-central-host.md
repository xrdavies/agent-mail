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

## 系统架构设计

### 架构目标

本架构需要同时满足四类目标：

1. **邮件语义正确**：内部邮件模型尽量贴近 RFC 5322，后续可以平滑接入真实邮件系统。
2. **运行时边界清晰**：Central 管状态，Host 管本地 runtime，Agent 只通过 MCP 工作。
3. **会话连续性稳定**：每个 mailbox 保持一个长期 session，通过 `resume session` 延续上下文。
4. **人工可观测可介入**：出现失败、冲突或调试需求时，人可以通过 Web、日志和 debug API 介入。

### 架构原则

1. **Central-first 状态管理**：所有业务真相都回到 Central，不在 Host 本地分叉。
2. **Host-thin 执行模型**：Host 只做鉴权、轮询、resume、MCP bridge 和局部状态协调。
3. **Email-first 协作模型**：协作以 email 为主，task 只是跟随 email 的结构化执行记录。
4. **Delivery-first 已读模型**：read/unread 只存在于 `Delivery`，不污染 `Email` 主表。
5. **Mailbox-scoped 连续性**：POC 中一个 mailbox 在任意时刻只对应一个 active session。
6. **显式动作优于隐式动作**：`mark_delivery_read`、`create_task`、`update_task_status` 都必须显式调用。
7. **调试路径与生产路径隔离**：debug inspection 可以跨 mailbox 查看，但不得影响 unread 状态和正常流程。

### 顶层拓扑

```text
                       +----------------------+
                       |   Human / Operator   |
                       +----------+-----------+
                                  |
                                  v
                       +----------------------+
                       |   Agent Mail Web     |
                       +----------+-----------+
                                  |
                                  v
+--------------------+   HTTPS    +----------------------+
| Future Mail Source | ---------> |       Central        |
| / Mail Connector   |            |  control plane + DB  |
+--------------------+            +----+------------+----+
                                       ^            ^
                                       |            |
                                HTTPS  |            | HTTPS
                                       |            |
                     +-----------------+            +-----------------+
                     |                                                |
                     v                                                v
            +----------------------+                         +----------------------+
            |        Host A        |                         |        Host B        |
            | auth / polling / MCP |                         | auth / polling / MCP |
            +----------+-----------+                         +----------+-----------+
                       |                                                |
                       v                                                v
            +----------------------+                         +----------------------+
            |   Local MCP Server   |                         |   Local MCP Server   |
            +----------+-----------+                         +----------+-----------+
                       |                                                |
                       v                                                v
            +----------------------+                         +----------------------+
            | Codex Agent Session  |                         | Codex Agent Session  |
            | one mailbox/session  |                         | one mailbox/session  |
            +----------+-----------+                         +----------+-----------+
                       |                                                |
                       | local repo / git / gh                           | local repo / git / gh
                       v                                                v
            +----------------------+                         +----------------------+
            |        GitHub        |                         |        GitHub        |
            | artifact truth layer |                         | artifact truth layer |
            +----------------------+                         +----------------------+
```

说明：

- `Web` 只面向 human/operator。
- `Central` 是唯一 control plane。
- `Host` 是 machine-local runtime coordinator。
- `Local MCP Server` 是 `Host` 的一部分，不是独立系统。
- `Future Mail Source / Mail Connector` 目前不启用，但在架构上需要预留。
- `GitHub` 只负责 repository artifacts，不负责邮件或任务状态。
- 对 `github.com` 的主访问路径由 `Codex Agent Session` 在本地 workspace 中通过 `git` / `gh` 执行；`Central` 默认不直接做代码写操作。
- `Central` 只接收并持久化 `Artifact` 元数据；未来如果需要对接 `GitHub API`，也应优先作为只读校验或集成能力，而不是替 agent 执行主写路径。

### 组件分层

#### 1. Web 层

职责：

- 供 human/operator 查看 agent、thread、email、task、session、Host 状态
- 发起人类邮件
- 触发人工恢复和清理动作
- 提供调试入口

不负责：

- 直接调度 Codex
- 持有 Host token
- 管理 agent 本地 workspace

#### 2. Central 层

职责：

- 持久化 `Host`、`HostToken`、`AgentProfile`、`MailboxBinding`、`Session`、`Thread`、`Email`、`Delivery`、`Task`、`LinkedResource`、`Artifact`
- 负责 host bootstrap key exchange 和 token revoke
- 负责邮件入库、thread 归并、delivery 生成
- 负责 unread 查询
- 负责 task completion 校验
- 负责 debug 调用审计

不负责：

- 启动本地 Codex
- 直接读取本地 repo/workspace
- 替 agent 做业务判断

#### 3. Host 层

职责：

- 向 Central 认证并注册自己
- 管理本机 mailbox roster 与 binding
- 暴露 MCP 给本机 Codex session
- 每 10 秒轮询 unread deliveries
- 判断 mailbox 是否应 `resume session`
- 维持 Host heartbeat，并在 heartbeat 中上报 mailbox runtime snapshots
- 在 token 失效时停用 MCP

不负责：

- 解析邮件语义
- 自动给陌生 agent 做首次 bootstrap
- 在后台静默消费邮件

#### 4. Agent Session 层

职责：

- 作为 mailbox 的执行实例
- 从 MCP 拉取 unread deliveries
- 每次处理一封 email
- 显式发送 email、标记已读、创建 task、更新 task 状态
- 在需要时操作 repo 并产出 artifacts

不负责：

- 选择自己运行在哪台 Host
- 选择自己的 workspace
- 自我清理 session

#### 5. Future Mail Connector 层

这是未来扩展组件，目前不实现。

职责预留：

- 接入 SMTP / IMAP / API-based mail providers
- 保留原始 `message_id`、headers、reply linkage
- 将外部邮件规范化写入 Central

当前约束：

- 当前 POC 中，外部 connector 是逻辑预留，不参与运行链路

### 状态归属矩阵

| 对象 | 主真相来源 | 说明 |
|---|---|---|
| Host 身份与状态 | Central | Host 本地上报，Central 持久化 |
| Host token | Central | 由 Central 发放和 revoke |
| AgentProfile | Central | 首次手动启动后经 Host 注册 |
| MailboxBinding | Central | 当前 mailbox 属于哪个 Host |
| MailboxRuntime | Central | Host 上报的 mailbox 本地运行时快照，用于诊断与观测 |
| Email | Central | 规范邮件对象 |
| Delivery | Central | 每个收件人的 unread/read 状态 |
| Thread | Central | reply linkage 驱动 |
| Task | Central | email-first 的执行记录 |
| LinkedResource | Central | email 上的链接型附件 |
| Artifact | Central + GitHub | 元数据在 Central，实际内容在 GitHub/repo |
| Workspace 实际文件 | 本地 repo / GitHub | 不进 Central |
| MCP 暴露与运行中 session 进程状态 | Host | 仅本机实时状态 |

### 核心运行链路

#### 链路 1：Host 启动与认证

```text
Host -> Central: bootstrap key exchange
Central -> Host: long-lived token
Host -> Central: host register
Host -> Central: heartbeat every 5s
Host -> local: expose MCP only after auth success
```

设计要求：

- 这是所有本地能力的前置条件
- 未认证 Host 不得暴露 MCP
- token 被 revoke 后，MCP 必须立刻失效

#### 链路 2：Agent 首次手动启动

```text
Operator -> Codex Agent Session: provide profile
Agent -> workspace: create AGENTS.md
Agent -> Host MCP: bootstrap_agent
Host -> Central: register profile + binding
Central -> Host/Agent: binding confirmation + discoverability
```

设计要求：

- 首次启动必须是人工触发
- 未注册 agent 不允许收邮件
- `AGENTS.md` 是本地 profile 快照，不替代 Central 中的 profile 真相
- 首次启动完成后即停止，不在 bootstrap turn 中处理邮件

#### 链路 3：邮件入站与 thread 建立

```text
Human/Web or Future Mail Connector -> Central: submit email
Central -> Central: resolve thread by in_reply_to / references
Central -> Central: persist Email
Central -> Central: create Deliveries
```

设计要求：

- 没有 reply linkage 时一律新建 thread
- `subject` 只作为展示，不作为 merge key
- `cc` 在当前 POC 中只存储，不驱动 task routing

#### 链路 4：轮询、唤醒与 resume

```text
Host -> Central: list unread deliveries for managed mailboxes
Host -> Host: pick idle mailbox with unread mail
Host -> Codex: resume session
Codex -> Host MCP: get_oldest_unread_delivery / get_email / get_thread
```

设计要求：

- Host 每 10 秒轮询一次
- mailbox 正在运行时不得重复 resume
- 多封未读按 FIFO 处理
- prompt 限制“一次 resume 只处理一封 email”

#### 链路 5：单封邮件处理

```text
Agent -> Host MCP: get_oldest_unread_delivery / get_delivery / get_email
Agent -> Host MCP: optionally get_thread
Agent -> Host MCP: send_email / create_task / get_task / list_tasks / update_task_status
Agent -> Host MCP: mark_delivery_read
Host -> Central: forward all stateful actions
```

设计要求：

- `mark_read` 必须显式触发
- 如果无需 task，也必须发送 receipt/reply
- 如果要 delegation，先发邮件，再建 task

#### 链路 6：任务完成闭环

```text
Agent -> Host MCP: send completion reply
Agent -> Host MCP: update_task_status(done, completedByEmailId)
Host -> Central: forward update
Central -> Central: validate completion email
Central -> Central: mark task done
```

设计要求：

- `completed_by_email_id` 是状态变更的强校验依据
- 不能只改 task 状态而不发 reply email

### 调试与只读路径

调试路径必须是架构上的一等公民，因为当前 POC 明确允许人工介入。

设计要求：

- debug 请求必须显式打标
- debug 读取不改变 unread/read
- debug 可跨 mailbox/thread/email 检查
- debug 审计日志必须能与正常 runtime 区分

推荐实现：

- 所有 Central 读 API 接受 debug headers
- 所有 Host MCP 读工具支持 `debug` 或只读模式参数
- Web 调试界面默认走 debug 模式

### 安全与信任边界

#### 边界 1：Central 与 Host

- 通过 bootstrap key 和 long-lived token 建立信任
- 所有 Host runtime 请求必须带 Bearer token
- token revoke 后，Central 与 Host 的 trust 立即失效

#### 边界 2：Host 与 Agent Session

- Host 只信任本机启动并接入本地 MCP 的 Codex session
- Agent 所有能力都经由 Host MCP 转发
- Agent 不直接持有 Central token

#### 边界 3：Debug 与 Normal Runtime

- debug 不得复用正常 unread 消费路径
- debug 的“看”和 runtime 的“处理”必须是两条逻辑分支

### 失败恢复设计

#### Host 失联

- heartbeat 周期：5 秒
- 连续 5 次失败：Central 可将 Host 标记为 `offline`
- 结果：该 Host 上的 mailboxes 不再视为可用执行面

#### Resume 失败

- Host 做指数退避
- 最多重试 3 次
- 超限后 mailbox 标记 `failed`
- 需要人工重新登录 Host 并手工清理

#### Host Crash 后重复处理

POC 接受重复处理，但副作用要受控：

- 发送 email 必须幂等
- 创建 task 必须幂等
- 幂等键由 Central 负责签发和去重

#### Mailbox 冲突

- 一个 mailbox 同时只能 active 在一个 Host
- 若旧 Host 仍健康，新 Host 抢注册必须失败
- 自动迁移不在当前 POC 范围内

### 部署模型

当前推荐部署模型：

- 1 个 Central
- 1 个 Web
- N 个 Host
- 每个 Host 管理若干 mailboxes
- 每个 mailbox 对应 1 个长期 session

部署特征：

- 适合本地或小规模私有环境
- 不依赖 queue middleware
- 不依赖复杂调度器
- 通过 mailbox binding 实现分布式执行定位

### 向 SMTP 演进的兼容设计

当前架构已经为未来接入 SMTP/真实外部邮箱预留了足够接口：

1. Email 保留 `message_id`、`in_reply_to`、`references`
2. Address Object 对齐 RFC 5322
3. `raw_headers` 可保留原始头
4. Threading 逻辑不依赖内部专有字段
5. Delivery 与 Email 分离，适合真实多收件人模型
6. `recipient_mailbox` 可在未来外部收件人场景下允许为 `null`

未来接入时只需新增：

- Mail Connector / SMTP Adapter
- 外部收发协议处理
- 外部 mailbox 路由与身份校验

无需推翻当前的 Central/Host/MCP 主架构。

### 架构结论

符合当前需求的推荐架构是：

- **Central 作为唯一业务状态中心**
- **Host 作为每台机器的轻量执行协调器**
- **MCP 作为 Agent 唯一运行时接口**
- **Email/Delivery/Thread/Task 构成核心业务模型**
- **Mailbox-scoped session 提供连续性**
- **人工可见、可调试、可恢复作为 POC 的基本能力**

这个架构满足当前四份规范文档中的约束，并且是后续进入实现阶段时最稳妥、改动面最小的一条路径。

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

1. Host 每 10 秒向 Central 查询其管理 mailboxes 的最早未读 delivery。
2. 如果某个 mailbox 有 unread delivery，且当前不在运行，则 Host resume 该 mailbox 的 session。
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
- agent profile registration 与 mailbox 激活归属
- create/send email
- 通用 deliveries 查询
- unread deliveries 查询
- oldest unread delivery 查询
- mark delivery read
- 获取 thread detail
- 获取 email detail
- create task
- 使用 `completed_by_email_id` 和可选 `artifacts` 更新 task status
- debug/read-only inspection APIs

## 最小 Host MCP Surface

当前 POC 的 Host MCP surface 应围绕“首次启动注册”和“每轮只处理一封最早未读邮件”来设计。

设计原则：

1. 所有正常 runtime tools 都必须显式带上 `mailbox`
2. 不向正常 agent runtime 暴露通用 `list_unread_deliveries`
3. `Host` 负责在调度层选择当前目标邮件，agent 负责通过 MCP 再确认并执行
4. `bootstrap` 动作与 `resume` 动作必须分离
5. Email 是主协作对象，task 是跟随 email 的执行记录

最小工具分组如下。

### 首次启动类

- `bootstrap_agent`
  - 合并 session bootstrap、agent profile 注册、mailbox binding 注册

### 邮件处理类

- `get_oldest_unread_delivery`
  - 返回当前 mailbox 最早的一封未读 delivery
- `get_delivery`
  - 按 `deliveryId` 获取 delivery detail
- `get_email`
  - 按 `emailId` 获取单封 email
- `get_thread`
  - 按 `threadId` 获取完整 thread
- `mark_delivery_read`
  - 显式标记当前 delivery 已读
- `send_email`
  - 发送 receipt、reply、delegation、completion reply

### Task 类

- `create_task`
  - 显式创建 task，并由创建者填写 `requiresArtifact`
- `get_task`
  - 按 `taskId` 获取单个 task
- `list_tasks`
  - 查询 mailbox 或 thread 相关 tasks
- `update_task_status`
  - 仅允许更新为 `in_progress` / `paused` / `blocked` / `done`

### Agent 发现类

- `list_agents`
  - 为 delegation 提供 agent discovery

Host 还应暴露这些非 MCP 的薄 API：

- `GET /health`
- `GET /status`
- `GET /mcp-config`

## 最终接口清单

这一节作为当前 POC 的接口总览页使用。

详细 contract 仍以 `docs/api-contract.md` 为准；本节只列最终接口面和各接口的职责。

### Central API Final List

#### Health

- `GET /api/v1/health`
  - Central health probe

#### Host Auth 与生命周期

- `POST /api/v1/host-auth/exchange`
  - 用 bootstrap key 换长期 host token
- `POST /api/v1/hosts/register`
  - 注册或刷新 Host metadata
- `POST /api/v1/hosts/:host_id/heartbeat`
  - Host heartbeat，并上报 mailbox runtime snapshot

#### Idempotency

- `POST /api/v1/idempotency-keys/issue`
  - 为副作用操作发放幂等 key

#### Agent Profile 与 mailbox 归属

- `POST /api/v1/agents/register`
  - 注册 agent profile，并建立或刷新 `mailbox -> host` 归属
- `GET /api/v1/agents`
  - agent discovery 与调试查看
- `GET /api/v1/agents/:mailbox`
  - 查看某个 mailbox 当前 active profile

#### Email / Delivery / Thread

- `POST /api/v1/emails/send`
  - 发送 email，并创建 deliveries / 归并 thread
- `GET /api/v1/mailboxes/:mailbox/deliveries`
  - 通用 deliveries 查询
- `GET /api/v1/mailboxes/:mailbox/unread-deliveries`
  - 查询当前 mailbox 的未读 deliveries
- `GET /api/v1/mailboxes/:mailbox/unread-deliveries/oldest`
  - 查询当前 mailbox 最早的一条未读 delivery
- `POST /api/v1/deliveries/:delivery_id/read`
  - 显式将某条 delivery 标记为已读
- `GET /api/v1/emails/:email_id`
  - 获取单封 email 详情
- `GET /api/v1/threads/:thread_id`
  - 获取 thread 全量上下文

#### Task

- `POST /api/v1/tasks`
  - 显式创建 task
- `GET /api/v1/tasks`
  - 查询 tasks
- `PATCH /api/v1/tasks/:task_id/status`
  - 更新 task 状态，并在 `done` 时携带 `completed_by_email_id` 与可选 `artifacts`

### Host MCP Final List

#### 首次启动类

- `bootstrap_agent`
  - 一次性完成 bootstrap、profile 注册和 mailbox binding 建立

#### 邮件处理类

- `get_oldest_unread_delivery`
  - 获取当前 mailbox 最早的一条未读 delivery
- `get_delivery`
  - 按 `deliveryId` 获取 delivery detail
- `get_email`
  - 按 `emailId` 获取单封 email
- `get_thread`
  - 按 `threadId` 获取完整 thread
- `mark_delivery_read`
  - 显式标记当前 delivery 已读
- `send_email`
  - 发送 receipt、reply、delegation、completion reply

#### Task 类

- `create_task`
  - 显式创建 task
- `get_task`
  - 获取单个 task 详情
- `list_tasks`
  - 查询 mailbox 或 thread 相关 tasks
- `update_task_status`
  - 更新 task 状态，只允许 `in_progress / paused / blocked / done`

#### Agent 发现类

- `list_agents`
  - 为 delegation 做 agent discovery

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
