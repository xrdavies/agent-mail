# Agent Mail API Contract

## Purpose

This document defines the API contract target for the next email-oriented Agent Mail POC.

It covers three layers:

1. **Agent Mail Central HTTP API**
2. **Agent Host Thin HTTP API**
3. **Agent Host Local MCP Contract**

This document replaces the earlier thread/message-first API draft for the next implementation slice.

## Contract Principles

1. Central owns the durable collaboration state.
2. Host is a thin local runtime bridge and not the source of truth.
3. Codex sessions should work through Host MCP only.
4. Email is the primary communication object.
5. Delivery is the read/unread state object.
6. Task is created explicitly and remains secondary to email.
7. Host must authenticate successfully before exposing MCP.
8. Debug inspection must be explicitly flagged and must not affect unread state.

## Versioning

- Central API base path: `/api/v1`
- Host thin API base path: local host root, for example `http://localhost:8788`
- MCP tools: versioned by Host release, not by tool-name suffix

## Authentication Model

### Bootstrap

POC bootstrap flow:

1. Host starts with a preconfigured bootstrap key.
2. Host exchanges the bootstrap key for a Central-issued long-lived token.
3. Host uses that token for normal Central API access.

### Runtime Auth

Central-facing Host requests should use:

```http
Authorization: Bearer <host_token>
```

Rules:

- one long-lived revocable token per Host
- Central should store token hashes, not raw tokens
- Host must stop exposing MCP if token validation fails or the token is revoked

### Debug Tagging

Read-only debug inspection must be explicit.

Recommended headers:

```http
X-Agent-Mail-Debug: true
X-Agent-Mail-Debug-Reason: manual-inspection
```

Rules:

- debug reads must not mutate delivery unread/read state
- debug calls should be logged distinctly from normal runtime calls

## Shared Type Conventions

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

Use ISO 8601 UTC strings.

Example:

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

Structured address objects are canonical.

For future SMTP compatibility, Central may also preserve raw RFC-style header strings separately on the email record.

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

## Resource Shapes

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

Purpose:

- Central health probe

Response `200`:

```json
{
  "ok": true
}
```

## Host Auth and Lifecycle

### `POST /api/v1/host-auth/exchange`

Purpose:

- exchange a bootstrap key for a long-lived host token

Request:

```json
{
  "host_id": "mac-local",
  "label": "Mac Local",
  "bootstrap_key": "bootstrap-key-value",
  "host_version": "0.2.0"
}
```

Response `200`:

```json
{
  "host": "Host",
  "host_token": "opaque-long-lived-token",
  "token_type": "Bearer"
}
```

### `POST /api/v1/hosts/register`

Purpose:

- register or refresh Host metadata after token exchange

Auth:

- required

Request:

```json
{
  "host_id": "mac-local",
  "label": "Mac Local",
  "host_version": "0.2.0"
}
```

Response `200`:

- `Host`

### `POST /api/v1/hosts/:host_id/heartbeat`

Purpose:

- refresh Host heartbeat and auth liveness

Auth:

- required

Request:

```json
{
  "host_status": "online",
  "managed_mailboxes": ["pm.aster@agents.local", "backend.coda@agents.local"]
}
```

Response `200`:

```json
{
  "ok": true,
  "last_heartbeat_at": "2026-06-13T12:05:00.000Z"
}
```

Rules:

- Host should heartbeat every 5 seconds
- after 5 consecutive failed or missing heartbeat checks, Central may mark the Host offline

## Idempotency Utility

### `POST /api/v1/idempotency-keys/issue`

Purpose:

- issue a Central-owned idempotency key for a side-effecting Host action

Auth:

- required

Request:

```json
{
  "host_id": "mac-local",
  "mailbox": "pm.aster@agents.local",
  "action": "send_email"
}
```

Response `200`:

```json
{
  "idempotency_key": "idem_send_001"
}
```

Notes:

- Host may call this automatically before forwarding `send_email` or `create_task`
- agents do not need to manage these keys directly in the POC interface

## Agent Profile and Binding APIs

### `POST /api/v1/agents/register`

Purpose:

- register or refresh the current active agent profile and mailbox binding

Auth:

- required

Request:

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

Response `200`:

```json
{
  "profile": "AgentProfile",
  "binding": "MailboxBinding"
}
```

Rules:

- if the mailbox is still actively bound to another healthy Host, Central should reject the registration with `409`
- if a profile change implies a new agent identity, Central should retire the previous active profile

### `GET /api/v1/agents`

Purpose:

- discover agents for delegation and debugging

Auth:

- required

Query parameters:

- `include_retired` optional, default `false`

Response `200`:

- `AgentProfile[]`

### `GET /api/v1/agents/:mailbox`

Purpose:

- fetch the current active profile for one mailbox

Auth:

- required

Response `200`:

- `AgentProfile`

## Session APIs

### `POST /api/v1/sessions/bind`

Purpose:

- bind or refresh a mailbox session after bootstrap or resume

Auth:

- required

Request:

```json
{
  "session_id": "sess_pm_001",
  "host_id": "mac-local",
  "mailbox": "pm.aster@agents.local",
  "workspace_path": "/Users/me/worktrees/pm-aster",
  "session_status": "bootstrapping"
}
```

Response `200`:

- `Session`

### `POST /api/v1/sessions/:session_id/heartbeat`

Purpose:

- refresh session runtime state

Auth:

- required

Request:

```json
{
  "mailbox": "pm.aster@agents.local",
  "session_status": "idle",
  "active_task_id": null,
  "last_processed_delivery_id": "del_001",
  "latest_summary": "Processed one unread email and sent a receipt reply."
}
```

Response `200`:

```json
{
  "ok": true,
  "last_heartbeat_at": "2026-06-13T12:05:00.000Z"
}
```

## Email, Delivery, and Thread APIs

### `POST /api/v1/emails/send`

Purpose:

- send an email, assign or resolve the thread, persist deliveries, and return the created records

Auth:

- required

Request:

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

Response `201`:

```json
{
  "email": "Email",
  "deliveries": ["Delivery"],
  "thread": "Thread"
}
```

Rules:

- Central generates internal `message_id`
- POC should enforce exactly one `to` recipient
- subject alone must not merge threads

### `GET /api/v1/mailboxes/:mailbox/deliveries`

Purpose:

- list deliveries for a mailbox, usually unread first for Host polling or agent consumption

Auth:

- required

Query parameters:

- `read_status` optional, for example `unread`
- `limit` optional
- `order` optional, use `oldest_first` for the POC default

Response `200`:

- `Delivery[]`

### `POST /api/v1/deliveries/:delivery_id/read`

Purpose:

- explicitly mark a delivery as read

Auth:

- required

Request:

```json
{
  "mailbox": "backend.coda@agents.local"
}
```

Response `200`:

```json
{
  "ok": true,
  "delivery_id": "del_001",
  "read_status": "read",
  "read_at": "2026-06-13T12:06:00.000Z"
}
```

### `GET /api/v1/emails/:email_id`

Purpose:

- fetch one email in full

Auth:

- required

Response `200`:

- `Email`

### `GET /api/v1/threads/:thread_id`

Purpose:

- fetch one thread plus its email timeline

Auth:

- required

Response `200`:

```json
{
  "thread": "Thread",
  "emails": ["Email"],
  "linked_resources": ["LinkedResource"],
  "tasks": ["Task"]
}
```

## Task and Artifact APIs

### `POST /api/v1/tasks`

Purpose:

- create a task explicitly from an email context

Auth:

- required

Request:

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

Response `201`:

- `Task`

Rules:

- `trigger_email_id` must belong to the same thread
- when created after a delegation email, `trigger_email_id` should be the delegation email id

### `GET /api/v1/tasks`

Purpose:

- list tasks for one mailbox, thread, or trigger email

Auth:

- required

Query parameters:

- `assignee_mailbox`
- `status`
- `thread_id`
- `trigger_email_id`
- `parent_task_id`

Response `200`:

- `Task[]`

### `PATCH /api/v1/tasks/:task_id/status`

Purpose:

- update task state and validate completion rules

Auth:

- required

Request:

```json
{
  "mailbox": "backend.coda@agents.local",
  "status": "done",
  "completed_by_email_id": "eml_002"
}
```

Response `200`:

- `Task`

Rules:

- when `status=done`, `completed_by_email_id` is required
- Central must verify:
  - the completion email belongs to the same thread
  - the completion email sender matches the task assignee
  - the completion email was created later than the task

### `POST /api/v1/artifacts`

Purpose:

- persist repository-output metadata for artifact-producing tasks

Auth:

- required

Request:

```json
{
  "task_id": "tsk_001",
  "mailbox": "backend.coda@agents.local",
  "repository": "xrdavies/agent-mail",
  "path": "docs/backend-runbook.md",
  "branch": "agent-mail/backend.coda/task_001",
  "commit_sha": "abc123",
  "pr_link": "https://github.com/xrdavies/agent-mail/pull/10"
}
```

Response `201`:

- `Artifact`

## Debug Read-Only APIs

The POC allows broad manual inspection for debugging, but read state must remain unchanged.

Recommended behavior:

- all normal GET APIs may be called with debug headers
- debug-tagged reads may inspect broader mailbox/thread/email scope
- debug-tagged reads must not trigger implicit or explicit unread-state mutation

Example:

```http
GET /api/v1/mailboxes/backend.coda@agents.local/deliveries?read_status=unread
X-Agent-Mail-Debug: true
X-Agent-Mail-Debug-Reason: manual-inspection
```

## Agent Host Thin HTTP API

These are local Host APIs for health, observability, and MCP bootstrap.

### `GET /health`

Response `200`:

```json
{
  "ok": true
}
```

### `GET /status`

Purpose:

- inspect current Host runtime state, managed mailboxes, and session health

Response `200`:

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

Purpose:

- expose MCP configuration helpers for both humans and scripts

Response `200`:

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

All normal runtime tools should keep `mailbox` explicit.

## Bootstrap and Registration

### `bootstrap_session`

Purpose:

- bind the current Codex session to a mailbox/workspace

Input:

```json
{
  "mailbox": "pm.aster@agents.local",
  "role": "pm",
  "name": "Aster",
  "responsibilities": "PM agent responsible for intake, clarification, coordination, and final synthesis.",
  "workspacePath": "/Users/me/worktrees/pm-aster"
}
```

### `register_agent_profile`

Purpose:

- register the agent profile and active mailbox binding through Host

Input:

```json
{
  "mailbox": "pm.aster@agents.local",
  "name": "Aster",
  "role": "pm",
  "responsibilities": "PM agent responsible for intake, clarification, coordination, and final synthesis."
}
```

## Runtime Mail Tools

### `get_runtime_context`

Purpose:

- return mailbox, host, session, and workspace runtime context

### `list_unread_deliveries`

Purpose:

- list unread deliveries for the mailbox, oldest first

Input:

```json
{
  "mailbox": "backend.coda@agents.local",
  "limit": 1,
  "debug": false
}
```

### `get_email`

Purpose:

- fetch one email in full

Input:

```json
{
  "mailbox": "backend.coda@agents.local",
  "emailId": "eml_001",
  "debug": false
}
```

### `get_thread`

Purpose:

- fetch the full thread only when the single email is not enough

Input:

```json
{
  "mailbox": "backend.coda@agents.local",
  "threadId": "thr_001",
  "debug": false
}
```

### `mark_delivery_read`

Purpose:

- explicitly mark a delivery as read

Input:

```json
{
  "mailbox": "backend.coda@agents.local",
  "deliveryId": "del_001"
}
```

### `send_email`

Purpose:

- send an email through Host and Central

Input:

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

## Runtime Task Tools

### `create_task`

Purpose:

- create an execution record from an email context

Input:

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

### `update_task_status`

Purpose:

- update status and supply `completedByEmailId` when done

Input:

```json
{
  "mailbox": "backend.coda@agents.local",
  "taskId": "tsk_001",
  "status": "done",
  "completedByEmailId": "eml_002"
}
```

### `list_agents`

Purpose:

- discover agents for delegation

Input:

```json
{
  "mailbox": "pm.aster@agents.local"
}
```

## Runtime Rules

1. Host polls unread deliveries every 10 seconds.
2. If a mailbox is already running, Host must not issue another resume for it.
3. Resume failures should use exponential backoff and stop after 3 attempts.
4. After repeated failure, Host should mark the mailbox failed and require human intervention.
5. Prompt policy should ask agents to process one unread delivery per resume turn.
6. Host should not auto-bootstrap agents that were never manually registered.
