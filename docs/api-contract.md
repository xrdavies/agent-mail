# Agent Mail API Contract

## Purpose

This document defines the API contract for the current Agent Mail POC.

It covers two distinct layers:

1. **Agent Mail Central HTTP API**
2. **Agent Host Local MCP Contract**

The goal is to make implementation unambiguous for:

- Agent Mail Central
- Agent Host
- Codex session integrations
- Web operator views

This is the contract target for the POC architecture. It is not a description of legacy endpoints or temporary compatibility shortcuts.

## Contract Principles

1. Agent Mail Central owns collaboration state.
2. Codex sessions do not talk to Central directly in the target architecture.
3. Codex sessions talk to local MCP only.
4. Mailbox is explicit in MCP calls during the POC.
5. Central APIs are resource-oriented and machine-readable.
6. Local MCP tools are mailbox-scoped and task-oriented.
7. Errors should clearly distinguish:
   - invalid request
   - unknown mailbox
   - stale session
   - resource not found
   - business-state conflict

## Versioning

Recommended versioning scheme:

- HTTP API base path: `/api/v1`
- Local MCP tools: versioned by Agent Host release, not by tool name suffix

For the POC, a single active version is acceptable, but the route shape should reserve room for later versioning.

## Authentication Assumptions

The POC does not standardize production auth yet.

Assume:

- Web talks to Central through the normal app session
- Agent Host talks to Central using machine-level credentials or local development trust
- Codex talks only to local Agent Host MCP

This document focuses on shape and semantics, not auth implementation.

## Shared Type Conventions

### Identifiers

- `machine_id`: string
- `mailbox`: string
- `session_id`: string
- `thread_id`: UUID/string
- `message_id`: UUID/string
- `task_id`: UUID/string
- `artifact_id`: UUID/string

### Timestamps

Use ISO 8601 UTC strings.

Example:

```json
"2026-06-09T12:00:00.000Z"
```

### Enumerations

#### `host_status`

- `online`
- `offline`
- `degraded`

#### `mailbox_status`

- `active`
- `disabled`
- `unassigned`

#### `session_status`

- `bootstrapping`
- `idle`
- `running`
- `waiting_human`
- `waiting_child`
- `failed`
- `cleared`

#### `thread_status`

- `open`
- `waiting_human`
- `waiting_agent`
- `completed`
- `blocked`

#### `task_status`

- `new`
- `in_progress`
- `paused`
- `done`
- `blocked`

#### `message_kind`

- `human_mail`
- `agent_reply`
- `delegation_mail`
- `summary_mail`
- `system_note`

#### `artifact_type`

- `document`
- `script`
- `code`
- `config`
- `test`
- `other`

## Resource Shapes

### Machine

```json
{
  "machine_id": "mac-b",
  "label": "Mac B",
  "host_status": "online",
  "host_version": "0.1.0",
  "last_heartbeat_at": "2026-06-09T12:00:00.000Z",
  "created_at": "2026-06-09T11:00:00.000Z",
  "updated_at": "2026-06-09T12:00:00.000Z"
}
```

### Mailbox

```json
{
  "mailbox": "pm.aster@agents.local",
  "name": "Aster",
  "role": "pm",
  "machine_id": "mac-b",
  "workspace_path": "/Users/me/worktrees/pm-aster",
  "git_user_name": "Aster",
  "git_user_email": "pm.aster@agents.local",
  "mailbox_status": "active",
  "created_at": "2026-06-09T11:00:00.000Z",
  "updated_at": "2026-06-09T12:00:00.000Z"
}
```

### Session

```json
{
  "session_id": "sess_pm_001",
  "mailbox": "pm.aster@agents.local",
  "machine_id": "mac-b",
  "workspace_path": "/Users/me/worktrees/pm-aster",
  "session_status": "idle",
  "active_task_id": "task_123",
  "last_processed_message_id": "msg_456",
  "latest_summary": "Waiting for QA and backend child tasks.",
  "last_heartbeat_at": "2026-06-09T12:00:00.000Z",
  "started_at": "2026-06-09T11:15:00.000Z",
  "cleared_at": null,
  "created_at": "2026-06-09T11:15:00.000Z",
  "updated_at": "2026-06-09T12:00:00.000Z"
}
```

### Thread

```json
{
  "thread_id": "thr_123",
  "subject": "Collect implementation feedback",
  "created_by_type": "human",
  "created_by_id": "human-user",
  "assigned_mailbox": "pm.aster@agents.local",
  "thread_status": "open",
  "created_at": "2026-06-09T11:00:00.000Z",
  "updated_at": "2026-06-09T12:00:00.000Z"
}
```

### Message

```json
{
  "message_id": "msg_456",
  "thread_id": "thr_123",
  "from_type": "agent",
  "from_id": "pm.aster@agents.local",
  "to_type": "agent",
  "to_id": "backend.coda@agents.local",
  "message_kind": "delegation_mail",
  "body": "Please review backend requirements for the next version.",
  "created_at": "2026-06-09T12:00:00.000Z"
}
```

### Task

```json
{
  "task_id": "task_123",
  "title": "Review backend requirements",
  "thread_id": "thr_123",
  "parent_task_id": "task_parent_001",
  "created_by_type": "agent",
  "created_by_id": "pm.aster@agents.local",
  "assignee_type": "agent",
  "assignee_mailbox": "backend.coda@agents.local",
  "requires_artifact": false,
  "status": "new",
  "created_at": "2026-06-09T12:00:00.000Z",
  "updated_at": "2026-06-09T12:00:00.000Z"
}
```

### Artifact

```json
{
  "artifact_id": "art_001",
  "task_id": "task_123",
  "mailbox": "backend.coda@agents.local",
  "artifact_type": "document",
  "path": "RUNBOOK.md",
  "branch": "agent-mail/backend.coda/task_123",
  "commit_sha": "abc123",
  "created_at": "2026-06-09T12:15:00.000Z"
}
```

## Central HTTP API

## Health

### `GET /api/v1/health`

Purpose:

- central service health check

Response `200`:

```json
{
  "ok": true
}
```

## Machine APIs

### `POST /api/v1/machines/register`

Purpose:

- create or refresh a machine record

Request:

```json
{
  "machine_id": "mac-b",
  "label": "Mac B",
  "host_version": "0.1.0"
}
```

Response `200`:

- `Machine`

### `POST /api/v1/machines/:machine_id/heartbeat`

Purpose:

- refresh host liveness

Request:

```json
{
  "host_status": "online"
}
```

Response `200`:

```json
{
  "ok": true,
  "last_heartbeat_at": "2026-06-09T12:00:00.000Z"
}
```

### `GET /api/v1/machines`

Purpose:

- list machines for Web operator view

Response `200`:

- `Machine[]`

## Mailbox APIs

### `POST /api/v1/mailboxes/register`

Purpose:

- create or refresh a mailbox binding on a machine

Request:

```json
{
  "mailbox": "pm.aster@agents.local",
  "name": "Aster",
  "role": "pm",
  "machine_id": "mac-b",
  "workspace_path": "/Users/me/worktrees/pm-aster",
  "git_user_name": "Aster",
  "git_user_email": "pm.aster@agents.local"
}
```

Response `200`:

- `Mailbox`

### `GET /api/v1/mailboxes`

Purpose:

- list known mailboxes

Response `200`:

- `Mailbox[]`

### `GET /api/v1/mailboxes/:mailbox`

Purpose:

- read one mailbox record

Response `200`:

- `Mailbox`

## Session APIs

### `POST /api/v1/sessions/bind`

Purpose:

- bind a mailbox to a concrete `session_id`

Request:

```json
{
  "session_id": "sess_pm_001",
  "mailbox": "pm.aster@agents.local",
  "machine_id": "mac-b",
  "workspace_path": "/Users/me/worktrees/pm-aster",
  "session_status": "bootstrapping"
}
```

Response `200`:

- `Session`

### `POST /api/v1/sessions/:session_id/heartbeat`

Purpose:

- refresh session liveness and state

Request:

```json
{
  "mailbox": "pm.aster@agents.local",
  "session_status": "idle",
  "active_task_id": "task_123",
  "last_processed_message_id": "msg_456",
  "latest_summary": "Waiting for QA and backend child tasks."
}
```

Response `200`:

```json
{
  "ok": true,
  "last_heartbeat_at": "2026-06-09T12:00:00.000Z"
}
```

### `GET /api/v1/sessions`

Purpose:

- list sessions for Web operator view

Response `200`:

- `Session[]`

### `GET /api/v1/sessions/:session_id`

Purpose:

- fetch one session record

Response `200`:

- `Session`

### `POST /api/v1/sessions/:session_id/clear`

Purpose:

- manual session clear

Request:

```json
{
  "mailbox": "pm.aster@agents.local",
  "requested_by": "human-user",
  "force": false
}
```

Response `200`:

```json
{
  "ok": true,
  "session_status": "cleared",
  "cleared_at": "2026-06-09T12:30:00.000Z"
}
```

## Collaboration APIs

### `POST /api/v1/threads`

Purpose:

- create a new thread and primary task

Request:

```json
{
  "subject": "Review implementation plan",
  "body": "Please review the implementation plan and coordinate follow-up work if needed.",
  "assigned_mailbox": "pm.aster@agents.local"
}
```

Response `201`:

```json
{
  "thread": "Thread",
  "primary_task": "Task",
  "messages": ["Message"]
}
```

### `GET /api/v1/threads`

Purpose:

- list thread summaries

Response `200`:

- array of thread summary objects

### `GET /api/v1/threads/:thread_id`

Purpose:

- return full thread detail

Response `200`:

```json
{
  "thread": "Thread",
  "primary_task": "Task | null",
  "related_tasks": ["Task"],
  "messages": ["Message"]
}
```

### `POST /api/v1/threads/:thread_id/messages`

Purpose:

- append a message to an existing thread

Request:

```json
{
  "from_type": "agent",
  "from_id": "pm.aster@agents.local",
  "to_type": "human",
  "to_id": "human-user",
  "message_kind": "summary_mail",
  "body": "Here is the current implementation summary."
}
```

Response `201`:

- full updated thread detail or created `Message`

### `GET /api/v1/tasks`

Purpose:

- list tasks with optional filters

Supported query parameters:

- `assignee_mailbox`
- `status`
- `thread_id`
- `parent_task_id`

Response `200`:

- `Task[]`

### `POST /api/v1/tasks`

Purpose:

- create a new task

Request:

```json
{
  "title": "Review backend requirements",
  "thread_id": "thr_123",
  "parent_task_id": "task_parent_001",
  "created_by_type": "agent",
  "created_by_id": "pm.aster@agents.local",
  "assignee_type": "agent",
  "assignee_mailbox": "backend.coda@agents.local",
  "requires_artifact": false,
  "status": "new",
  "body": "Please summarize backend requirements and interface constraints."
}
```

Response `201`:

- `Task`

### `PATCH /api/v1/tasks/:task_id/status`

Purpose:

- update task status

Request:

```json
{
  "status": "done"
}
```

Response `200`:

- `Task`

### `POST /api/v1/artifacts`

Purpose:

- persist artifact metadata when a task reports concrete output

Request:

```json
{
  "task_id": "task_123",
  "mailbox": "backend.coda@agents.local",
  "artifact_type": "document",
  "path": "RUNBOOK.md",
  "branch": "agent-mail/backend.coda/task_123",
  "commit_sha": "abc123"
}
```

Response `201`:

- `Artifact`

## Context APIs

These APIs exist for Agent Host runtime forwarding and Web debug views.

### `GET /api/v1/mailboxes/:mailbox/tasks`

Purpose:

- list pending and recent tasks for a mailbox

Response `200`:

- `Task[]`

### `GET /api/v1/tasks/:task_id/work-package`

Purpose:

- provide the preferred structured context unit for a resumed turn

Response `200`:

```json
{
  "task": "Task",
  "thread": "Thread",
  "latest_summary": "string | null",
  "new_messages": ["Message"],
  "open_child_tasks": ["Task"],
  "recent_artifacts": ["Artifact"]
}
```

### `GET /api/v1/threads/:thread_id/delta`

Purpose:

- return only messages after a known message id

Query parameters:

- `after_message_id`

Response `200`:

```json
{
  "thread_id": "thr_123",
  "messages": ["Message"]
}
```

### `GET /api/v1/agents`

Purpose:

- list known agent identities for delegation choices

Response `200`:

- `Mailbox[]`

## Local MCP Contract

The Codex session talks only to local MCP tools exposed by Agent Host.

All mailbox-scoped runtime operations keep mailbox explicit in the POC.

## MCP Tool Result Convention

Recommended behavior:

- success returns `content` with human-readable text
- optionally include structured data when useful
- business/tool errors return `isError: true` in the tool result
- protocol-level failures should use normal JSON-RPC / MCP transport errors

This matches MCP expectations: tool-level failures belong in the tool result, not as protocol failure, whenever the server understood the request but the business action failed.

## Bootstrap Tools

### `bootstrap_session`

Input:

```json
{
  "mailbox": "pm.aster@agents.local",
  "role": "pm",
  "name": "Aster",
  "workspacePath": "/Users/me/worktrees/pm-aster"
}
```

Behavior:

- validate local mailbox ownership
- validate workspace binding
- bind mailbox -> session_id

Success result:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Session bootstrapped for pm.aster@agents.local"
    }
  ]
}
```

### `get_runtime_context`

Input:

```json
{
  "mailbox": "pm.aster@agents.local"
}
```

Result should describe:

- mailbox
- role
- name
- workspace path
- machine id
- current bound session id if any

## Runtime Tools

### `list_mailbox_tasks`

Input:

```json
{
  "mailbox": "pm.aster@agents.local"
}
```

Result:

- text summary
- optionally structured task list

### `get_task_work_package`

Input:

```json
{
  "mailbox": "pm.aster@agents.local",
  "taskId": "task_123"
}
```

Result:

- text summary
- structured work package payload

### `get_thread_delta`

Input:

```json
{
  "mailbox": "pm.aster@agents.local",
  "threadId": "thr_123",
  "afterMessageId": "msg_456"
}
```

Result:

- text summary
- structured delta payload

### `get_full_thread`

Input:

```json
{
  "mailbox": "pm.aster@agents.local",
  "threadId": "thr_123"
}
```

Result:

- full thread detail

### `reply_thread`

Input:

```json
{
  "mailbox": "pm.aster@agents.local",
  "threadId": "thr_123",
  "toMailbox": "human-user",
  "body": "Here is the next step."
}
```

### `create_child_task`

Input:

```json
{
  "mailbox": "pm.aster@agents.local",
  "threadId": "thr_123",
  "title": "Review backend constraints",
  "toMailbox": "backend.coda@agents.local",
  "body": "Please summarize backend constraints for the next version.",
  "requiresArtifact": false
}
```

### `update_task_status`

Input:

```json
{
  "mailbox": "backend.coda@agents.local",
  "taskId": "task_123",
  "status": "done"
}
```

### `list_agents`

Input:

```json
{
  "mailbox": "pm.aster@agents.local"
}
```

Result:

- known agent identities and mailboxes

## Error Semantics

## HTTP API Errors

Recommended HTTP error patterns:

- `400` invalid payload
- `404` missing resource
- `409` state conflict
- `422` semantically invalid transition
- `500` internal failure

Recommended error body:

```json
{
  "error": {
    "code": "TASK_STATE_CONFLICT",
    "message": "Task cannot transition from done to in_progress.",
    "details": {}
  }
}
```

## MCP Tool Errors

Recommended tool-level failure shape:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Mailbox not found."
    }
  ],
  "isError": true
}
```

Use protocol-level JSON-RPC/MCP errors only when:

- the request is malformed
- the tool name does not exist
- the MCP transport/session is invalid

## State Constraints

Important contract rules:

1. `bootstrap_session` must fail if the mailbox is not owned by the local host.
2. `bootstrap_session` must fail if the workspace path does not match configured binding.
3. `clear session` does not delete metadata; it only clears the active binding.
4. `create_child_task` must keep the child task on the same `thread_id` as the parent.
5. `requiresArtifact=true` should be explicit, not inferred at the transport layer.
6. `get_thread_delta` must be safe to call repeatedly and return deterministic ordering.

## Contract Evolution Rule

If implementation diverges from this document:

- update this document first or in the same change
- do not introduce undocumented Central API or local MCP behavior
