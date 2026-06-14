# Agent Mail Data Model

## 目的

本文档定义下一版以 email 为中心的 Agent Mail POC 的规范数据模型。

它服务于：

- Central schema design
- Host orchestration design
- API contract design
- 通过 `codex exec resume` 实现 session continuity
- 为未来 SMTP 和互联网邮件兼容预留空间

对于下一轮实现切片，本文档替代早先通用的 `thread/message` 模型。

## 建模原则

1. mailbox-address identity 是稳定的协作边界。
2. Email 是主要通信对象。
3. Delivery 是按收件人拆分的状态对象。
4. Thread 通过 reply linkage 聚合 emails，而不是依赖 subject-only 规则。
5. Task 主要附着在触发它的 email 上，次要关联到 thread。
6. Host 是 runtime 边界；agent profile 是身份/profile 边界。
7. 一个 mailbox 同时只能 active 在一个 Host 上。
8. POC 中一个 mailbox 同时只能有一个 active session。
9. read state 不能放在 email row 本身上。
10. repository delivery artifacts 与 email-linked resources 不能混为一谈。

## 规范术语

### Address Object

Agent Mail 应使用与 RFC 5322 对齐的结构化 address object：

```json
{
  "display_name": "Aster",
  "address": "pm.aster@agents.local"
}
```

规则：

- `from` 是单个 address object
- `to` 是 address objects 数组
- `cc` 是 address objects 数组
- POC 为未来兼容保留数组建模
- POC runtime 强制只有一个主 `to` recipient
- 为了 display、回放与未来 SMTP 兼容，可单独保留原始 RFC-style header strings

## 核心实体

下一版 email-oriented POC 需要这些实体：

- `Host`
- `HostToken`
- `AgentProfile`
- `MailboxBinding`
- `Session`
- `Thread`
- `Email`
- `Delivery`
- `Task`
- `LinkedResource`
- `Artifact`

## 实体：Host

表示一个已注册到 Central 的本地 Agent Host daemon 实例。

### 字段

- `host_id`
  - 类型：string
  - 唯一
  - 稳定的 Host identity
- `label`
  - 类型：string
  - 可读的 Host 名称
- `host_version`
  - 类型：string
  - 可选
- `host_status`
  - enum：
    - `online`
    - `offline`
    - `degraded`
    - `auth_failed`
- `last_heartbeat_at`
  - timestamp
- `last_authenticated_at`
  - timestamp
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### 说明

- 这个实体在下一版 POC 中替代早先的 `Machine`
- 一个 Host 可以管理多个 active mailbox bindings
- Host 必须先鉴权成功，才能暴露 MCP

## 实体：HostToken

表示 Central 为某个 Host 颁发的长期 token。

### 字段

- `token_id`
  - 类型：string
  - 唯一
- `host_id`
  - 外键，指向 `Host.host_id`
- `token_hash`
  - 类型：string
  - Central 不应存储原始 token
- `token_status`
  - enum：
    - `active`
    - `revoked`
- `issued_at`
  - timestamp
- `revoked_at`
  - timestamp
  - 可空
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### 说明

- bootstrap keys 只用于交换，不作为正常 runtime credential
- POC 中每个 Host 只有一个长期、可 revoke 的 token

## 实体：AgentProfile

表示一条已注册的 agent identity/profile 记录。

### 字段

- `agent_id`
  - 类型：string
  - 唯一
- `mailbox`
  - 类型：string
  - mailbox address，例如 `pm.aster@agents.local`
- `name`
  - 类型：string
- `role`
  - 受约束字符串
  - 示例：
    - `pm`
    - `tech_lead`
    - `backend`
    - `frontend`
    - `smart_contract`
    - `qa`
    - `security`
    - `ops`
- `responsibilities`
  - 类型：text
  - POC 中按 role 固定模板整理的职责描述
- `profile_status`
  - enum：
    - `active`
    - `retired`
    - `unavailable`
- `registered_by_host_id`
  - 外键，指向 `Host.host_id`
- `created_at`
  - timestamp
- `updated_at`
  - timestamp
- `retired_at`
  - timestamp
  - 可空

### 说明

- 在 POC 中，mailbox 或 name 的变化视为新的 agent identity
- 旧 profiles 会转为 `retired`，并保留可查询历史
- 同一 mailbox 同时只应有一条非 retired profile
- `retired` agent 可以读取历史信息，但不能发送新邮件

## 实体：MailboxBinding

表示当前某个 mailbox identity 在某个 Host 上的本地归属关系。

### 字段

- `binding_id`
  - 类型：string
  - 唯一
- `agent_id`
  - 外键，指向 `AgentProfile.agent_id`
- `mailbox`
  - 类型：string
  - mailbox 快照
- `host_id`
  - 外键，指向 `Host.host_id`
- `workspace_path`
  - 类型：string
  - 本地可写 workspace/worktree 路径
- `git_user_name`
  - 类型：string
- `git_user_email`
  - 类型：string
- `binding_status`
  - enum：
    - `active`
    - `inactive`
    - `failed`
- `bound_at`
  - timestamp
- `unbound_at`
  - timestamp
  - 可空
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### 说明

- 一个 mailbox 同时只能有一个 active binding
- 如果另一个 Host 试图认领仍存活的 binding，Central 必须拒绝
- 在 POC 中，Host 重启可能会重置 bindings，随后需要重新注册

## 实体：Session

表示一个 mailbox-scoped 的长期 Codex session。

### 字段

- `session_id`
  - 类型：string
  - 唯一
- `mailbox`
  - 类型：string
  - mailbox 快照
- `host_id`
  - 外键，指向 `Host.host_id`
- `workspace_path`
  - 类型：string
  - bootstrap 时实际使用的路径
- `session_status`
  - enum：
    - `bootstrapping`
    - `idle`
    - `running`
    - `failed`
    - `cleared`
- `active_task_id`
  - 外键，指向 `Task.task_id`
  - 可空
- `last_processed_delivery_id`
  - 外键，指向 `Delivery.delivery_id`
  - 可空
- `latest_summary`
  - 类型：text
  - 可空
- `started_at`
  - timestamp
- `last_heartbeat_at`
  - timestamp
- `cleared_at`
  - timestamp
  - 可空
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### 说明

- 一个 mailbox 最多只能有一个 non-cleared session
- Host 通过 `resume session` 延续上下文，而不是为每封 unread email 新建 session

## 实体：Thread

表示一个通过 reply linkage 构建的稳定会话 thread。

### 字段

- `thread_id`
  - 类型：string
  - 唯一
- `root_email_id`
  - 外键，指向 `Email.email_id`
- `root_message_id`
  - 类型：string
- `root_subject`
  - 类型：string
- `latest_email_id`
  - 外键，指向 `Email.email_id`
  - 可空
- `thread_status`
  - enum：
    - `open`
    - `waiting_human`
    - `waiting_agent`
    - `completed`
    - `blocked`
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### 说明

- thread assignment 由 `in_reply_to` 和 `references` 驱动
- 不允许以 subject 作为主要 merge key
- 如果 reply linkage 缺失，Central 在 POC 中创建新 thread
- UI 应使用首封 email 的 subject 作为 thread 标题

## 实体：Email

表示一封持久化的 email。

### 字段

- `email_id`
  - 类型：string
  - 唯一
- `message_id`
  - 类型：string
  - 唯一
- `thread_id`
  - 外键，指向 `Thread.thread_id`
- `from`
  - structured address object
- `to`
  - structured address objects 数组
- `cc`
  - structured address objects 数组
- `subject`
  - 类型：string
- `body_text`
  - 类型：text
- `raw_body`
  - 类型：text
- `raw_headers`
  - 类型：object
  - 可选，用于保留原始 headers，例如：
    - `from`
    - `to`
    - `cc`
    - `subject`
- `in_reply_to`
  - 类型：string
  - 可空
- `references`
  - 类型：字符串数组
- `email_kind`
  - enum：
    - `human_inbound`
    - `agent_reply`
    - `agent_delegation`
    - `agent_receipt`
    - `system_note`
- `send_state`
  - enum：
    - `draft`
    - `sent`
    - `failed`
- `created_by_host_id`
  - 外键，指向 `Host.host_id`
  - 可空
- `created_by_mailbox`
  - 类型：string
  - 可空
- `sent_at`
  - timestamp
  - 可空
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### 说明

- POC 内部邮件的 `message_id` 由 Central 生成
- 未来 SMTP ingress/egress 应在可行时保留外部 `message_id`
- POC 首版只要求 send 流程可用，但 `send_state` 仍预留 `draft`
- `cc` 会保留在模型里，但当前不参与 task routing
- `raw_headers` 可在 Central 或未来 mail connector 需要精确回放时保留原始 header strings

## 实体：Delivery

表示某封 email 面向某个 recipient 的 delivery state。

### 字段

- `delivery_id`
  - 类型：string
  - 唯一
- `email_id`
  - 外键，指向 `Email.email_id`
- `thread_id`
  - 外键，指向 `Thread.thread_id`
- `recipient_address`
  - 类型：string
- `recipient_mailbox`
  - 类型：string
  - 对未来外部 recipients 可空
- `delivery_kind`
  - enum：
    - `to`
    - `cc`
- `read_status`
  - enum：
    - `unread`
    - `read`
- `read_at`
  - timestamp
  - 可空
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### 说明

- unread/read 只在 delivery 层跟踪，不挂在 `Email` 上
- agents 必须通过 MCP 显式 `mark_read`
- debug 读取不得修改 `read_status`

## 实体：Task

表示从 email 上派生出的执行记录。

### 字段

- `task_id`
  - 类型：string
  - 唯一
- `thread_id`
  - 外键，指向 `Thread.thread_id`
- `trigger_email_id`
  - 外键，指向 `Email.email_id`
- `parent_task_id`
  - 外键，指向 `Task.task_id`
  - 可空
- `created_by_email_id`
  - 外键，指向 `Email.email_id`
  - 可空
- `created_by_mailbox`
  - 类型：string
- `assignee_mailbox`
  - 类型：string
- `title`
  - 类型：string
- `instructions`
  - 类型：text
  - 可空
- `requires_artifact`
  - boolean
- `status`
  - enum：
    - `new`
    - `in_progress`
    - `paused`
    - `done`
    - `blocked`
- `completed_by_email_id`
  - 外键，指向 `Email.email_id`
  - 可空
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### 说明

- task 是 email-first、thread-second
- 如果 agent 先发 delegation email 再建 task，`trigger_email_id` 必须指向 delegation email
- 没有有效 `completed_by_email_id` 时，task 不得标记为 `done`

## 实体：LinkedResource

表示挂在 email 上的链接型附件资源。

### 字段

- `linked_resource_id`
  - 类型：string
  - 唯一
- `email_id`
  - 外键，指向 `Email.email_id`
- `url`
  - 类型：string
- `title`
  - 类型：string
  - 可空
- `mime_type`
  - 类型：string
  - 可空
- `size_bytes`
  - 类型：integer
  - 可空
- `created_at`
  - timestamp

### 说明

- POC 不支持二进制上传附件
- agents 只发送链接

## 实体：Artifact

表示为某个 task 产出的 repository output。

### 字段

- `artifact_id`
  - 类型：string
  - 唯一
- `task_id`
  - 外键，指向 `Task.task_id`
- `produced_by_mailbox`
  - 类型：string
- `repository`
  - 类型：string
  - 可空
- `path`
  - 类型：string
- `branch`
  - 类型：string
  - 可空
- `commit_sha`
  - 类型：string
  - 可空
- `pr_link`
  - 类型：string
  - 可空
- `created_at`
  - timestamp

### 说明

- `Artifact` 只用于 repository delivery outputs
- `LinkedResource` 只用于 email-linked materials
- 这两类对象必须保持分离

## 关键不变量

1. 一个 mailbox 同时只能有一个 active Host binding。
2. 一个 mailbox 同时只能有一个 non-cleared session。
3. 每封 email 必须且只能属于一个 thread。
4. Thread assignment 由 `in_reply_to` 和 `references` 驱动。
5. 不允许 subject-only 匹配合并 threads。
6. 即使 `to` 在模型中是数组，POC send flows 仍应强制只有一个主 `to` recipient。
7. 每个 email delivery 都有自己的 unread/read 生命周期。
8. 在 debug/read-only inspection 中，delivery read state 不得变化。
9. 每个 task 必须同时引用 `thread_id` 和 `trigger_email_id`。
10. `Task.trigger_email_id` 必须属于与 `Task.thread_id` 相同的 thread。
11. 只有当 `completed_by_email_id` 满足以下条件时，task 才能标记为 `done`：
    - 位于同一 thread
    - 发件人就是当前 assignee mailbox
    - 创建时间晚于 task 本身
12. `retired` mailbox 不得发送新邮件。
13. `LinkedResource` rows 是 email-scoped，而不是 task-scoped。
14. `Artifact` rows 是 task-scoped，而不是 email-scoped。

## 推荐派生视图

- 按 mailbox 列出 unread deliveries，按最旧优先
- 按 Host 查看 active mailbox bindings
- 按 mailbox 查看 active sessions
- thread 最新 email 摘要
- 按 mailbox 查看待处理 tasks
- 按 trigger email 查看 delegated tasks
- retired agent 的历史查询视图
- 等待人工恢复的 failed mailboxes

## 推荐索引

至少应建立以下索引：

- `Host.last_heartbeat_at`
- `HostToken.host_id, token_status`
- `AgentProfile.mailbox, profile_status`
- `MailboxBinding.host_id, binding_status`
- `MailboxBinding.mailbox, binding_status`
- `Session.mailbox, session_status`
- `Thread.root_message_id`
- `Email.message_id`
- `Email.thread_id, created_at`
- `Delivery.recipient_mailbox, read_status, created_at`
- `Task.assignee_mailbox, status, updated_at`
- `Task.thread_id`
- `Task.trigger_email_id`
- `Artifact.task_id`
- `LinkedResource.email_id`

## 后续仍可细化的点

当前模型已经足以支撑下一轮实现，但未来阶段仍可能继续调整：

1. `draft` 是否从保留态变为真正激活的持久化流程
2. 外部 SMTP ingress 如何映射到 `recipient_mailbox = null` 的 deliveries
3. idempotency 是否需要单独的持久化实体，而不是仅维持在 request scope
