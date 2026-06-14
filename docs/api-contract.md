# Agent Mail API Contract

## 目的

本文档定义下一版 email-oriented Agent Mail POC 的 API contract 目标。

它覆盖三层：

1. **Agent Mail Central HTTP API**
2. **Agent Host Thin HTTP API**
3. **Agent Host Local MCP Contract**

对于下一轮实现切片，本文档替代早先以 thread/message 为中心的 API 草案。

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
- Host thin API base path：本地 Host 根路径，例如 `http://localhost:8788`
- MCP tools：按 Host release 版本化，而不是在 tool name 上追加版本后缀

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

#### `session_status`

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

### Session

```json
{
  "session_id": "sess_pm_001",
  "mailbox": "pm.aster@agents.local",
  "host_id": "mac-local",
  "workspace_path": "/Users/me/worktrees/pm-aster",
  "session_status": "idle",
  "active_task_id": null,
  "last_processed_delivery_id": "del_001",
  "latest_summary": "Handled one unread email and delegated a backend follow-up.",
  "started_at": "2026-06-13T12:01:00.000Z",
  "last_heartbeat_at": "2026-06-13T12:05:00.000Z",
  "cleared_at": null,
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
  "managed_mailboxes": ["pm.aster@agents.local", "backend.coda@agents.local"]
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

- 必需

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

- 必需

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

- 必需

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

- 必需

响应 `200`：

- `Delivery | null`

### `POST /api/v1/deliveries/:delivery_id/read`

用途：

- 显式将某个 delivery 标记为已读

Auth：

- 必需

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

- 必需

响应 `200`：

- `Email`

### `GET /api/v1/threads/:thread_id`

用途：

- 获取单个 thread 及其 email 时间线

Auth：

- 必需

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

## Agent Host Thin HTTP API

这些是 Host 暴露给本地的 thin HTTP API，用于 health、observability 和 MCP bootstrap。

### `GET /health`

响应 `200`：

```json
{
  "ok": true
}
```

### `GET /status`

用途：

- 查看当前 Host runtime state、managed mailboxes 与 session health

响应 `200`：

```json
{
  "host": "Host",
  "managed_mailboxes": ["pm.aster@agents.local", "backend.coda@agents.local"],
  "mailbox_status": [
    {
      "mailbox": "pm.aster@agents.local",
      "session_status": "idle",
      "pending_unread_count": 1
    }
  ]
}
```

### `GET /mcp-config`

用途：

- 暴露 MCP 配置辅助信息，供人工和脚本使用

响应 `200`：

```json
{
  "command": "codex mcp add agent-mail-host --url http://localhost:8788/mcp",
  "json": {
    "mcpServers": {
      "agent-mail-host": {
        "url": "http://localhost:8788/mcp"
      }
    }
  },
  "toml": "[mcp_servers.agent-mail-host]\nurl = \"http://localhost:8788/mcp\"\n"
}
```

## Host MCP Contract

所有正常 runtime tools 都应显式带上 `mailbox`。

设计原则：

1. 所有正常 runtime tools 都必须显式带上 `mailbox`
2. Host 面向 agent 的工具必须围绕“每次只处理一封最早未读邮件”设计
3. 不向正常 agent runtime 暴露通用 `list_unread_deliveries`
4. `Host` 负责调度和注入当前目标邮件，agent 负责通过 MCP 再确认并执行
5. Email 是主协作对象，task 是跟随 email 的执行记录

## Bootstrap 与注册

### `bootstrap_agent`

用途：

- 在首次手动启动时，一次性完成 session bootstrap、agent profile 注册和 active mailbox binding 注册

输入：

```json
{
  "mailbox": "pm.aster@agents.local",
  "name": "Aster",
  "role": "pm",
  "responsibilities": "PM agent responsible for intake, clarification, coordination, and final synthesis.",
  "workspacePath": "/Users/me/worktrees/pm-aster"
}
```

输出：

```json
{
  "hostId": "mac-local",
  "mailbox": "pm.aster@agents.local",
  "workspacePath": "/Users/me/worktrees/pm-aster",
  "profileStatus": "active",
  "bindingStatus": "active"
}
```

校验规则：

- `mailbox` 必须属于当前 Host 的本地配置
- `workspacePath` 必须与该 mailbox 的配置绑定一致
- 若 mailbox 仍 active 绑定在另一台健康 Host 上，应拒绝
- 该 tool 仅用于首次手动启动或重新绑定后的初始化

## Runtime Mail Tools

### `get_oldest_unread_delivery`

用途：

- 获取当前 mailbox 最早的一封未读 delivery

输入：

```json
{
  "mailbox": "backend.coda@agents.local"
}
```

输出：

```json
{
  "deliveryId": "del_001",
  "emailId": "eml_001",
  "threadId": "thr_001",
  "recipientMailbox": "backend.coda@agents.local",
  "readStatus": "unread",
  "createdAt": "2026-06-14T10:00:00.000Z"
}
```

或当不存在未读邮件时：

```json
null
```

校验规则：

- 只返回一条最旧的未读 delivery
- 不返回已读项
- 不允许 agent 用此接口挑选多封邮件

### `get_delivery`

用途：

- 按 `deliveryId` 获取单条 delivery detail，用于在本轮开始时再次确认

输入：

```json
{
  "mailbox": "backend.coda@agents.local",
  "deliveryId": "del_001"
}
```

输出：

```json
{
  "deliveryId": "del_001",
  "emailId": "eml_001",
  "threadId": "thr_001",
  "recipientAddress": "backend.coda@agents.local",
  "recipientMailbox": "backend.coda@agents.local",
  "deliveryKind": "to",
  "readStatus": "unread",
  "createdAt": "2026-06-14T10:00:00.000Z"
}
```

校验规则：

- `deliveryId` 必须属于 `mailbox`
- 该 tool 只读，不得修改 unread/read 状态

### `get_email`

用途：

- 完整获取单封 email

输入：

```json
{
  "mailbox": "backend.coda@agents.local",
  "emailId": "eml_001"
}
```

输出：

- `Email`

### `get_thread`

用途：

- 仅在单封 email 不足以安全行动时，再获取完整 thread

输入：

```json
{
  "mailbox": "backend.coda@agents.local",
  "threadId": "thr_001"
}
```

输出：

```json
{
  "thread": "Thread",
  "emails": ["Email"],
  "linked_resources": ["LinkedResource"],
  "tasks": ["Task"]
}
```

校验规则：

- `get_thread` 不应作为默认第一步，而应在单封 email 不足时调用

### `mark_delivery_read`

用途：

- 显式将某个 delivery 标记为已读

输入：

```json
{
  "mailbox": "backend.coda@agents.local",
  "deliveryId": "del_001"
}
```

输出：

```json
{
  "ok": true,
  "deliveryId": "del_001",
  "readStatus": "read",
  "readAt": "2026-06-13T12:06:00.000Z"
}
```

校验规则：

- `deliveryId` 必须属于 `mailbox`
- 重复调用应保持幂等
- debug/read-only 路径不应调用该 tool

### `send_email`

用途：

- 通过 Host 和 Central 发送 email

输入：

```json
{
  "mailbox": "pm.aster@agents.local",
  "to": [
    {
      "display_name": "Coda",
      "address": "backend.coda@agents.local"
    }
  ],
  "cc": [],
  "subject": "Please review backend requirements",
  "bodyText": "Please summarize backend constraints and reply in-thread.",
  "rawBody": "Please summarize backend constraints and reply in-thread.",
  "inReplyTo": "<am-parent@agent-mail.local>",
  "references": ["<am-root@agent-mail.local>", "<am-parent@agent-mail.local>"],
  "linkedResources": []
}
```

输出：

```json
{
  "emailId": "eml_002",
  "threadId": "thr_001",
  "messageId": "<am-002@agent-mail.local>"
}
```

校验规则：

- `mailbox` 必须与发件身份一致
- POC 中 `to` 虽然是数组，但应强制只有一个主 `to` recipient
- 可用于 receipt、direct reply、delegation、completion reply

## Runtime Task Tools

### `create_task`

用途：

- 从 email context 创建执行记录

输入：

```json
{
  "mailbox": "pm.aster@agents.local",
  "threadId": "thr_001",
  "triggerEmailId": "eml_001",
  "assigneeMailbox": "backend.coda@agents.local",
  "title": "Review backend requirements",
  "instructions": "Summarize backend constraints and reply in-thread.",
  "parentTaskId": "tsk_parent_001",
  "requiresArtifact": false
}
```

输出：

```json
{
  "taskId": "tsk_002",
  "status": "new"
}
```

校验规则：

- `triggerEmailId` 必须属于 `threadId`
- `requiresArtifact` 必须显式提供，不能由 Host 或 Central 自动猜测
- 如果是 delegation 场景，`triggerEmailId` 应指向 delegation email

### `get_task`

用途：

- 按 `taskId` 获取单个 task 的完整详情

输入：

```json
{
  "mailbox": "backend.coda@agents.local",
  "taskId": "tsk_002"
}
```

输出：

- `Task`

校验规则：

- `taskId` 必须对当前 `mailbox` 可见
- 该 tool 只读，不改变 task 状态

### `list_tasks`

用途：

- 查询当前 mailbox 或某个 thread 下的相关 tasks

输入：

```json
{
  "mailbox": "pm.aster@agents.local",
  "threadId": "thr_001",
  "status": "new",
  "parentTaskId": "tsk_parent_001"
}
```

所有过滤字段均为可选。

输出：

- `Task[]`

校验规则：

- 至少必须显式带 `mailbox`
- 允许按 `threadId` / `status` / `parentTaskId` 过滤
- 正常 agent runtime 不应使用它替代“每轮只处理一封邮件”的主流程

### `update_task_status`

用途：

- 更新 task 状态，并在完成时提供 `completedByEmailId`

输入：

```json
{
  "mailbox": "backend.coda@agents.local",
  "taskId": "tsk_001",
  "status": "done",
  "completedByEmailId": "eml_002",
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

允许状态：

- `in_progress`
- `paused`
- `blocked`
- `done`

输出：

- 更新后的 `Task`

校验规则：

- 只允许上述四种状态
- 若 `status = done`，则 `completedByEmailId` 必填
- 若 `status = done` 且目标 task 的 `requiresArtifact = true`，则 `artifacts` 必填
- 若 `status != done`，则 `completedByEmailId` 应忽略或为空
- 当 `status = done` 时，Central 仍必须验证：
  - completion email 与 task 在同一 thread
  - completion email sender 与当前 assignee 一致
  - completion email 创建时间晚于 task 创建时间

## Agent 发现类

### `list_agents`

用途：

- 为 delegation 做 agent discovery

输入：

```json
{
  "mailbox": "pm.aster@agents.local"
}
```

输出：

- `mailbox`
- `name`
- `role`
- `status`

## Runtime 规则

1. Host 每 10 秒轮询一次 unread deliveries。
2. 如果某个 mailbox 已在运行，Host 不得再次对其发起 resume。
3. 正常 agent runtime 应以 `get_oldest_unread_delivery` 作为邮件处理入口。
4. 正常 agent runtime 不应依赖通用 `list_unread_deliveries`。
5. Resume 失败时应做指数退避，并在 3 次后停止。
6. 多次失败后，Host 应将 mailbox 标记为 failed，并等待人工介入。
7. Prompt policy 应要求 agents 每次 resume 只处理一条 unread delivery。
8. Host 不得自动 bootstrap 从未手动注册过的 agents。
