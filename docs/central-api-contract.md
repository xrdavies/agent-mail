# Agent Mail Central API Contract

## 目的

本文档定义下一版 email-oriented Agent Mail POC 中 `Central HTTP API` 的 contract 目标，以及 `Central` 与 `Host` 共用的契约约定。

它覆盖两层内容：

1. **共享契约约定**
2. **Agent Mail Central HTTP API**

`Host Thin HTTP API` 与 `Host MCP Contract` 已拆分到 [host-api-contract.md](./host-api-contract.md)。

## Contract 原则

1. Central 拥有持久化协作状态。
2. Host 是轻量的本地 runtime bridge，而不是真相来源。
3. Codex sessions 只应通过 Host MCP 工作。
4. Email 是主要通信对象。
5. Delivery 是 read/unread 状态对象。
6. Task 需要显式创建，并且始终从属于 email。
7. Host 必须先完成鉴权，才能暴露 MCP。
8. Debug inspection 必须显式打标，且不能影响 unread 状态。

## Versioning

- Central API base path：`/api/v1`
- Host thin API 与 MCP tools 的版本与路径约定见 [host-api-contract.md](./host-api-contract.md)

## 鉴权模型

### Bootstrap

POC 的 bootstrap 流程：

1. Host 以预配置的 bootstrap key 启动。
2. Host 用 bootstrap key 换取一个由 Central 颁发的长期 token。
3. Host 用该 token 访问正常的 Central API。

### Runtime Auth

Host 调用 Central API 时应使用：

```http
Authorization: Bearer <host_token>
```

规则：

- POC 中每个 Host 只有一个长期、可 revoke 的 token
- Central 应只存 token hash，不存原始 token
- 如果 token 校验失败或被 revoke，Host 必须停止暴露 MCP

### Debug Tagging

只读 debug inspection 必须显式标记。

推荐 headers：

```http
X-Agent-Mail-Debug: true
X-Agent-Mail-Debug-Reason: manual-inspection
```

规则：

- debug 读取不得修改 delivery unread/read state
- debug 调用应与正常 runtime traffic 分开记录

## 共享类型约定

### Identifiers

- `host_id`: string
- `agent_id`: string
- `binding_id`: string
- `session_id`: string
- `thread_id`: string
- `email_id`: string
- `message_id`: string
- `delivery_id`: string
- `task_id`: string
- `artifact_id`: string
- `linked_resource_id`: string

### Timestamps

统一使用 ISO 8601 UTC 字符串。

示例：

```json
"2026-06-13T12:00:00.000Z"
```

### Address Object

```json
{
  "display_name": "Aster",
  "address": "pm.aster@agents.local"
}
```

Structured address objects 是规范形式。

为兼容未来 SMTP，Central 也可以在 email record 上单独保留原始 RFC-style header strings。

### Enumerations

#### `host_status`

- `online`
- `offline`
- `degraded`
- `auth_failed`

#### `profile_status`

- `active`
- `retired`
- `unavailable`

#### `binding_status`

- `active`
- `inactive`
- `failed`

#### `mailbox_runtime_status`

- `bootstrapping`
- `idle`
- `running`
- `failed`
- `cleared`

#### `thread_status`

- `open`
- `waiting_human`
- `waiting_agent`
- `completed`
- `blocked`

#### `email_kind`

- `human_inbound`
- `agent_reply`
- `agent_delegation`
- `agent_receipt`
- `system_note`

#### `send_state`

- `draft`
- `sent`
- `failed`

#### `read_status`

- `unread`
- `read`

#### `task_status`

- `new`
- `in_progress`
- `paused`
- `done`
- `blocked`

## 资源结构

### Host

```json
{
  "host_id": "mac-local",
  "label": "Mac Local",
  "host_version": "0.2.0",
  "host_status": "online",
  "last_heartbeat_at": "2026-06-13T12:00:00.000Z",
  "last_authenticated_at": "2026-06-13T11:58:00.000Z",
  "created_at": "2026-06-13T11:58:00.000Z",
  "updated_at": "2026-06-13T12:00:00.000Z"
}
```

### Agent Profile

```json
{
  "agent_id": "agt_001",
  "mailbox": "pm.aster@agents.local",
  "name": "Aster",
  "role": "pm",
  "responsibilities": "PM agent responsible for intake, clarification, coordination, and final synthesis.",
  "profile_status": "active",
  "registered_by_host_id": "mac-local",
  "created_at": "2026-06-13T12:00:00.000Z",
  "updated_at": "2026-06-13T12:00:00.000Z",
  "retired_at": null
}
```

### Mailbox Binding

```json
{
  "binding_id": "bind_001",
  "agent_id": "agt_001",
  "mailbox": "pm.aster@agents.local",
  "host_id": "mac-local",
  "workspace_path": "/Users/me/worktrees/pm-aster",
  "git_user_name": "Aster",
  "git_user_email": "pm.aster@agents.local",
  "binding_status": "active",
  "bound_at": "2026-06-13T12:00:00.000Z",
  "unbound_at": null,
  "created_at": "2026-06-13T12:00:00.000Z",
  "updated_at": "2026-06-13T12:00:00.000Z"
}
```

### Mailbox Runtime

```json
{
  "mailbox": "pm.aster@agents.local",
  "host_id": "mac-local",
  "workspace_path": "/Users/me/worktrees/pm-aster",
  "current_session_id": "sess_pm_001",
  "mailbox_runtime_status": "idle",
  "active_task_id": null,
  "last_processed_delivery_id": "del_001",
  "latest_summary": "Handled one unread email and delegated a backend follow-up.",
  "last_heartbeat_at": "2026-06-13T12:05:00.000Z",
  "created_at": "2026-06-13T12:01:00.000Z",
  "updated_at": "2026-06-13T12:05:00.000Z"
}
```

### Email

```json
{
  "email_id": "eml_001",
  "message_id": "<am-001@agent-mail.local>",
  "thread_id": "thr_001",
  "from": {
    "display_name": "Aster",
    "address": "pm.aster@agents.local"
  },
  "to": [
    {
      "display_name": "Coda",
      "address": "backend.coda@agents.local"
    }
  ],
  "cc": [],
  "subject": "Please review backend requirements",
  "body_text": "Please summarize the backend constraints for this feature.",
  "raw_body": "Please summarize the backend constraints for this feature.",
  "raw_headers": {
    "from": "Aster <pm.aster@agents.local>",
    "to": "Coda <backend.coda@agents.local>",
    "cc": "",
    "subject": "Please review backend requirements"
  },
  "in_reply_to": "<am-parent@agent-mail.local>",
  "references": ["<am-root@agent-mail.local>", "<am-parent@agent-mail.local>"],
  "email_kind": "agent_delegation",
  "send_state": "sent",
  "created_by_host_id": "mac-local",
  "created_by_mailbox": "pm.aster@agents.local",
  "sent_at": "2026-06-13T12:04:00.000Z",
  "created_at": "2026-06-13T12:04:00.000Z",
  "updated_at": "2026-06-13T12:04:00.000Z"
}
```

### Delivery

```json
{
  "delivery_id": "del_001",
  "email_id": "eml_001",
  "thread_id": "thr_001",
  "recipient_address": "backend.coda@agents.local",
  "recipient_mailbox": "backend.coda@agents.local",
  "delivery_kind": "to",
  "read_status": "unread",
  "read_at": null,
  "created_at": "2026-06-13T12:04:00.000Z",
  "updated_at": "2026-06-13T12:04:00.000Z"
}
```

### Thread

```json
{
  "thread_id": "thr_001",
  "root_email_id": "eml_000",
  "root_message_id": "<am-root@agent-mail.local>",
  "root_subject": "Collect implementation feedback",
  "latest_email_id": "eml_001",
  "thread_status": "open",
  "created_at": "2026-06-13T12:00:00.000Z",
  "updated_at": "2026-06-13T12:04:00.000Z"
}
```

### Task

```json
{
  "task_id": "tsk_001",
  "thread_id": "thr_001",
  "trigger_email_id": "eml_001",
  "parent_task_id": "tsk_parent_001",
  "created_by_email_id": "eml_001",
  "created_by_mailbox": "pm.aster@agents.local",
  "assignee_mailbox": "backend.coda@agents.local",
  "title": "Review backend requirements",
  "instructions": "Summarize backend constraints and reply in-thread.",
  "requires_artifact": false,
  "status": "new",
  "completed_by_email_id": null,
  "created_at": "2026-06-13T12:04:00.000Z",
  "updated_at": "2026-06-13T12:04:00.000Z"
}
```

### Linked Resource

```json
{
  "linked_resource_id": "lnk_001",
  "email_id": "eml_001",
  "url": "https://example.com/spec.pdf",
  "title": "Spec PDF",
  "mime_type": "application/pdf",
  "size_bytes": 1024,
  "created_at": "2026-06-13T12:04:00.000Z"
}
```

## Central HTTP API

## Health

### `GET /api/v1/health`

用途：

- Central health probe

响应 `200`：

```json
{
  "ok": true
}
```

## Host Auth 与生命周期

### `POST /api/v1/host-auth/exchange`

用途：

- 将 bootstrap key 交换为长期 host token

请求：

```json
{
  "host_id": "mac-local",
  "label": "Mac Local",
  "bootstrap_key": "bootstrap-key-value",
  "host_version": "0.2.0"
}
```

响应 `200`：

```json
{
  "host": "Host",
  "host_token": "opaque-long-lived-token",
  "token_type": "Bearer"
}
```

### `POST /api/v1/hosts/register`

用途：

- 在 token 交换完成后，注册或刷新 Host metadata

Auth：

- 必需

请求：

```json
{
  "host_id": "mac-local",
  "label": "Mac Local",
  "host_version": "0.2.0"
}
```

响应 `200`：

- `Host`

### `POST /api/v1/hosts/:host_id/heartbeat`

用途：

- 刷新 Host heartbeat 和 auth 存活状态

Auth：

- 必需

请求：

```json
{
  "host_status": "online",
  "managed_mailboxes": [
    {
      "mailbox": "pm.aster@agents.local",
      "binding_status": "active",
      "mailbox_runtime_status": "idle",
      "last_processed_delivery_id": "del_001",
      "current_session_id": "sess_pm_001"
    },
    {
      "mailbox": "backend.coda@agents.local",
      "binding_status": "active",
      "mailbox_runtime_status": "running",
      "last_processed_delivery_id": "del_011",
      "current_session_id": "sess_backend_001"
    }
  ]
}
```

响应 `200`：

```json
{
  "ok": true,
  "last_heartbeat_at": "2026-06-13T12:05:00.000Z"
}
```

规则：

- Host 应每 5 秒发送一次 heartbeat
- 若连续 5 次 heartbeat 缺失或失败，Central 可将该 Host 标记为 offline

## Idempotency 辅助接口

### `POST /api/v1/idempotency-keys/issue`

用途：

- 为 Host 的副作用操作发放一个由 Central 管理的 idempotency key

Auth：

- 必需

请求：

```json
{
  "host_id": "mac-local",
  "mailbox": "pm.aster@agents.local",
  "action": "send_email"
}
```

响应 `200`：

```json
{
  "idempotency_key": "idem_send_001"
}
```

说明：

- Host 可以在转发 `send_email` 或 `create_task` 前自动调用此接口
- POC 中 agent 不需要自己管理这些 key

## Agent Profile 与 Binding API

### `POST /api/v1/agents/register`

用途：

- 注册或刷新当前 active agent profile 与 mailbox binding

Auth：

- 必需

请求：

```json
{
  "host_id": "mac-local",
  "mailbox": "pm.aster@agents.local",
  "name": "Aster",
  "role": "pm",
  "responsibilities": "PM agent responsible for intake, clarification, coordination, and final synthesis.",
  "workspace_path": "/Users/me/worktrees/pm-aster",
  "git_user_name": "Aster",
  "git_user_email": "pm.aster@agents.local"
}
```

响应 `200`：

```json
{
  "profile": "AgentProfile",
  "binding": "MailboxBinding"
}
```

规则：

- 如果该 mailbox 仍 active 绑定在另一台健康 Host 上，Central 应返回 `409`
- 如果 profile 变更意味着新的 agent identity，Central 应 retire 旧的 active profile

### `GET /api/v1/agents`

用途：

- 为 delegation 与调试提供 agent discovery

Auth：

- 必需

查询参数：

- `include_retired` 可选，默认 `false`

响应 `200`：

- `AgentProfile[]`

### `GET /api/v1/agents/:mailbox`

用途：

- 获取某个 mailbox 当前 active profile

Auth：

- 必需

响应 `200`：

- `AgentProfile`

## Email、Delivery 与 Thread API

### `POST /api/v1/emails/send`

用途：

- 发送一封 email，解析或创建 thread，持久化 deliveries，并返回创建结果

Auth：

- 当前 P0/P1 实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

请求：

```json
{
  "idempotency_key": "idem_send_001",
  "mailbox": "pm.aster@agents.local",
  "from": {
    "display_name": "Aster",
    "address": "pm.aster@agents.local"
  },
  "to": [
    {
      "display_name": "Coda",
      "address": "backend.coda@agents.local"
    }
  ],
  "cc": [],
  "subject": "Please review backend requirements",
  "body_text": "Please summarize the backend constraints for this feature.",
  "raw_body": "Please summarize the backend constraints for this feature.",
  "raw_headers": {
    "from": "Aster <pm.aster@agents.local>",
    "to": "Coda <backend.coda@agents.local>",
    "cc": "",
    "subject": "Please review backend requirements"
  },
  "in_reply_to": "<am-parent@agent-mail.local>",
  "references": ["<am-root@agent-mail.local>", "<am-parent@agent-mail.local>"],
  "email_kind": "agent_delegation",
  "linked_resources": []
}
```

响应 `201`：

```json
{
  "email": "Email",
  "deliveries": ["Delivery"],
  "thread": "Thread"
}
```

规则：

- Central 生成内部 `message_id`
- POC 应强制只有一个 `to` recipient
- 不允许仅通过 subject 合并 threads

### `GET /api/v1/mailboxes/:mailbox/deliveries`

用途：

- 通用 deliveries 查询
- 适合 Web / Debug / 管理界面查看全部、已读或未读 deliveries

Auth：

- 当前 P0/P1 实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

查询参数：

- `read_status` 可选，例如 `unread`
- `limit` 可选
- `order` 可选，POC 默认使用 `oldest_first`

响应 `200`：

- `Delivery[]`

### `GET /api/v1/mailboxes/:mailbox/unread-deliveries`

用途：

- 只返回某个 mailbox 当前未读的 deliveries
- 适合 Host 查看未读队列

Auth：

- 当前 P0/P1 实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

查询参数：

- `limit` 可选
- `order` 可选，默认 `oldest_first`

响应 `200`：

- `Delivery[]`

### `GET /api/v1/mailboxes/:mailbox/unread-deliveries/oldest`

用途：

- 直接返回某个 mailbox 最早的一条未读 delivery
- 这是 Host 10 秒轮询的推荐主入口

Auth：

- 当前 P0/P1 实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

响应 `200`：

- `Delivery | null`

### `POST /api/v1/deliveries/:delivery_id/read`

用途：

- 显式将某个 delivery 标记为已读

Auth：

- 当前 P0/P1 实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

请求：

```json
{
  "mailbox": "backend.coda@agents.local"
}
```

响应 `200`：

```json
{
  "ok": true,
  "delivery_id": "del_001",
  "read_status": "read",
  "read_at": "2026-06-13T12:06:00.000Z"
}
```

### `GET /api/v1/emails/:email_id`

用途：

- 完整获取单封 email

Auth：

- 当前 P0/P1 实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

响应 `200`：

- `Email`

### `GET /api/v1/threads/:thread_id`

用途：

- 获取单个 thread 及其 email 时间线

Auth：

- 当前 P0/P1 实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

响应 `200`：

```json
{
  "thread": "Thread",
  "emails": ["Email"],
  "linked_resources": ["LinkedResource"],
  "tasks": ["Task"]
}
```

## Task API

### `POST /api/v1/tasks`

用途：

- 从 email context 显式创建 task

Auth：

- 必需

请求：

```json
{
  "idempotency_key": "idem_task_001",
  "mailbox": "pm.aster@agents.local",
  "thread_id": "thr_001",
  "trigger_email_id": "eml_001",
  "parent_task_id": "tsk_parent_001",
  "assignee_mailbox": "backend.coda@agents.local",
  "title": "Review backend requirements",
  "instructions": "Summarize backend constraints and reply in-thread.",
  "requires_artifact": false
}
```

响应 `201`：

- `Task`

规则：

- `trigger_email_id` 必须属于相同的 thread
- 如果 task 是在 delegation email 之后创建，则 `trigger_email_id` 应指向 delegation email

### `GET /api/v1/tasks`

用途：

- 按 mailbox、thread 或 trigger email 列出 tasks

Auth：

- 必需

查询参数：

- `assignee_mailbox`
- `status`
- `thread_id`
- `trigger_email_id`
- `parent_task_id`

响应 `200`：

- `Task[]`

### `GET /api/v1/tasks/:task_id`

用途：

- 供 Host / Debug / 内部诊断按 id 获取单个 task

Auth：

- 必需

响应 `200`：

- `Task`

响应 `404`：

- task 不存在

### `PATCH /api/v1/tasks/:task_id/status`

用途：

- 更新 task state，并在完成时校验 completion rules

Auth：

- 必需

请求：

```json
{
  "mailbox": "backend.coda@agents.local",
  "status": "done",
  "completed_by_email_id": "eml_002",
  "artifacts": [
    {
      "repository": "xrdavies/agent-mail",
      "path": "docs/backend-runbook.md",
      "branch": "agent-mail/backend.coda/task_001",
      "commit_sha": "abc123",
      "pr_link": "https://github.com/xrdavies/agent-mail/pull/10"
    }
  ]
}
```

响应 `200`：

- `Task`

允许状态：

- `in_progress`
- `paused`
- `blocked`
- `done`

规则：

- 当 `status=done` 时，`completed_by_email_id` 必填
- 当 `status=done` 且 `requires_artifact=true` 时，`artifacts` 必填且至少有一项
- 当 `status!=done` 时，不应要求 `artifacts`
- Central 必须验证：
  - completion email 属于同一 thread
  - completion email sender 与 task assignee 一致
  - completion email 的创建时间晚于 task 创建时间

## Web Read Model API

这些接口服务于 `central-web`，目的是减少前端自己用多个底层接口做 N+1 拼装。

### `GET /api/v1/hosts`

用途：

- 供 `Hosts` 列表页读取 host 摘要

Auth：

- 当前 `central-web` 开发期实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

响应 `200`：

```json
{
  "hosts": [
    {
      "host": "Host",
      "managed_mailboxes": 3,
      "running_mailboxes": 1,
      "failed_mailboxes": 0,
      "unread_deliveries": 3
    }
  ]
}
```

### `GET /api/v1/hosts/:host_id`

用途：

- 供 `Host Detail` 页读取 host runtime snapshot

Auth：

- 当前 `central-web` 开发期实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

响应 `200`：

- `runtimeSnapshotSchema`

### `GET /api/v1/web/threads`

用途：

- 供 `Threads` 列表页读取 thread summary 列表

Auth：

- 当前 `central-web` 开发期实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

查询参数：

- `status`
- `mailbox`
- `limit`

响应 `200`：

```json
{
  "threads": [
    {
      "thread": "Thread",
      "participants": ["pm.aster@agents.local", "backend.coda@agents.local"],
      "latest_email": "Email",
      "open_task_count": 1
    }
  ]
}
```

### `GET /api/v1/web/threads/:thread_id`

用途：

- 供 `Thread Detail` 页获取单个 thread 全量上下文

Auth：

- 当前 `central-web` 开发期实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

响应 `200`：

- `threadDetailResponseSchema`

### `GET /api/v1/web/emails`

用途：

- 供 `Mails` 列表页读取 email summary 列表

Auth：

- 当前 `central-web` 开发期实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

查询参数：

- `mailbox`
- `thread_id`
- `kind`
- `direction`
- `limit`

响应 `200`：

```json
{
  "emails": [
    {
      "email": "Email",
      "direction": "sent",
      "counterparty": "backend.coda@agents.local"
    }
  ]
}
```

### `GET /api/v1/web/emails/:email_id`

用途：

- 供 `Mail Detail` 页获取单封 email 详情

Auth：

- 当前 `central-web` 开发期实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

响应 `200`：

- `Email`

### `GET /api/v1/web/tasks`

用途：

- 供 `Tasks` 列表页读取 task summary 列表

Auth：

- 当前 `central-web` 开发期实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

查询参数：

- `status`
- `assignee_mailbox`
- `created_by_mailbox`
- `thread_id`
- `requires_artifact`
- `limit`

响应 `200`：

```json
{
  "tasks": [
    {
      "task": "Task",
      "thread": "Thread",
      "trigger_email": "Email",
      "completed_by_email": "Email | null",
      "artifact_count": 1
    }
  ]
}
```

### `GET /api/v1/web/tasks/:task_id`

用途：

- 供 `Task Detail` 页读取单个 task 聚合详情

Auth：

- 当前 `central-web` 开发期实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

响应 `200`：

```json
{
  "task": "Task",
  "thread": "Thread",
  "trigger_email": "Email",
  "completed_by_email": "Email | null",
  "artifacts": ["Artifact"]
}
```

### `GET /api/v1/web/mailboxes`

用途：

- 供 `Mailboxes` 列表页读取 mailbox summary 列表

Auth：

- 当前 `central-web` 开发期实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

查询参数：

- `host_id`
- `runtime_status`
- `binding_status`
- `has_unread`

响应 `200`：

```json
{
  "mailboxes": [
    {
      "profile": "AgentProfile",
      "binding": "MailboxBinding",
      "runtime": "MailboxRuntime",
      "host": "Host",
      "unread_deliveries": 2,
      "open_task_count": 1
    }
  ]
}
```

### `GET /api/v1/web/mailboxes/:mailbox`

用途：

- 供 `Mailbox Detail` 页读取 mailbox 聚合详情

Auth：

- 当前 `central-web` 开发期实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

查询参数：

- `activity_limit`

响应 `200`：

```json
{
  "profile": "AgentProfile",
  "binding": "MailboxBinding",
  "runtime": "MailboxRuntime",
  "host": "Host",
  "activity": [
    {
      "direction": "sent",
      "email": "Email",
      "delivery": null
    },
    {
      "direction": "received",
      "email": "Email",
      "delivery": "Delivery"
    }
  ],
  "threads": ["Thread"],
  "tasks": ["Task"]
}
```

### `GET /api/v1/web/overview`

用途：

- 供 `Overview` 页读取 dashboard 聚合数据

Auth：

- 当前 `central-web` 开发期实现中不要求 `Host` bearer token
- 这是面向 human/operator 的只读路径

响应 `200`：

```json
{
  "counters": {
    "unread_deliveries": 12,
    "waiting_human_threads": 4,
    "blocked_tasks": 3,
    "online_hosts": 2
  },
  "oldest_unread": [],
  "host_health": [],
  "attention_threads": [],
  "recent_activity": []
}
```

### `POST /api/v1/web/emails/human-send`

用途：

- 供 `Compose` 页以 human/operator 身份发起一封 `human_inbound` 邮件

Auth：

- 当前 `central-web` 开发期实现中不要求 `Host` bearer token
- 这是面向 human/operator 的写路径

请求：

```json
{
  "from": {
    "display_name": "Human Operator",
    "address": "human.operator@example.com"
  },
  "to": [
    {
      "display_name": "Aster",
      "address": "pm.aster@agents.local"
    }
  ],
  "cc": [],
  "subject": "Need API follow-up",
  "body_text": "Please review the backend constraints and reply in-thread.",
  "raw_body": "Please review the backend constraints and reply in-thread.",
  "raw_headers": {
    "from": "Human Operator <human.operator@example.com>",
    "to": "Aster <pm.aster@agents.local>",
    "cc": "",
    "subject": "Need API follow-up"
  },
  "references": [],
  "linked_resources": [
    {
      "url": "https://github.com/xrdavies/agent-mail/pull/18"
    }
  ]
}
```

响应 `201`：

```json
{
  "email": "Email",
  "deliveries": ["Delivery"],
  "thread": "Thread"
}
```

规则：

- Central 将该邮件持久化为 `email_kind = "human_inbound"`
- 如果省略 `raw_body`，Central 应使用 `body_text`
- 如果省略 `raw_headers`，Central 应根据 `from`、`to`、`cc`、`subject` 自动生成
- POC 仍要求 `to.length = 1`
- 目标收件人必须是 Central 已注册 mailbox

## Debug 只读 API

POC 允许为了开发和排障做较宽松的人工 inspection，但 unread state 必须保持不变。

推荐行为：

- 所有正常 GET API 都可以加 debug headers 调用
- 带 debug 标记的读取可以查看更广的 mailbox/thread/email 范围
- 带 debug 标记的读取绝不能触发隐式或显式已读

示例：

```http
GET /api/v1/mailboxes/backend.coda@agents.local/deliveries?read_status=unread
X-Agent-Mail-Debug: true
X-Agent-Mail-Debug-Reason: manual-inspection
```
