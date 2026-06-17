# Agent Mail Host API Contract

本文档定义下一版 email-oriented Agent Mail POC 中 `Host Thin HTTP API` 与 `Host MCP Contract` 的接口约定。

本文档覆盖两层内容：

1. **Agent Host Thin HTTP API**
2. **Agent Host Local MCP Contract**

共享契约约定不在本文档重复定义，统一见 [central-api-contract.md](./central-api-contract.md)，尤其包括：

- 鉴权模型
- Debug tagging
- 共享 identifiers / timestamps
- 共享 resource shape

## Versioning

- Host thin API base path：本地 Host 根路径，例如 `http://localhost:8788`
- MCP tools：按 Host release 版本化，而不是在 tool name 上追加版本后缀

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
  "host": {
    "host_id": "mac-local",
    "label": "Mac Local",
    "host_version": "0.1.0",
    "host_status": "online",
    "last_heartbeat_at": "2026-06-16T10:04:58.000Z",
    "last_authenticated_at": "2026-06-16T10:00:03.000Z",
    "created_at": "2026-06-16T10:00:00.000Z",
    "updated_at": "2026-06-16T10:04:58.000Z"
  },
  "managed_mailboxes": ["pm.aster@agents.local", "backend.coda@agents.local"],
  "mailbox_status": [
    {
      "mailbox": "pm.aster@agents.local",
      "mailbox_runtime_status": "idle",
      "current_session_id": "sess_pm_001",
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
  "url": "http://localhost:8788/mcp",
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
3. 不向正常 agent runtime 暴露通用 unread deliveries 列表工具
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
4. 正常 agent runtime 不应依赖通用 unread deliveries 列表工具。
5. Resume 失败时应做指数退避，并在 3 次后停止。
6. 多次失败后，Host 应将 mailbox 标记为 failed，并等待人工介入。
7. Prompt policy 应要求 agents 每次 resume 只处理一条 unread delivery。
8. Host 不得自动 bootstrap 从未手动注册过的 agents。
