# Agent Mail POC v0.1 Specification Supplement

## Status

This document records the clarified POC direction discussed after the initial thread/message/task prototype.

It is intended to supplement the existing design documents. When this document conflicts with earlier POC docs, use this document for the next email-oriented POC iteration.

## Purpose

This POC should move Agent Mail closer to a real internet mail collaboration model without integrating SMTP yet.

The system should:

- use a minimal RFC 5322-aligned email shape
- keep Central as the durable source of truth
- keep Host as a thin local runtime bridge
- let agents work through Host MCP only
- preserve future compatibility with real external mail systems

## Core Decisions

1. Email uses standard mail concepts such as `from`, `to`, `cc`, `subject`, `message_id`, `in_reply_to`, and `references`.
2. `from`, `to`, and `cc` use structured address objects, not plain strings.
3. `to` and `cc` are arrays, but the POC currently enforces a single primary `to` recipient.
4. Threading is based on `in_reply_to` and `references`, not subject matching.
5. If an incoming email has no reply linkage, Central always creates a new thread in the POC.
6. Task ownership is email-first and thread-second.
7. Host authenticates to Central before exposing MCP.
8. Each Host has one revocable long-lived token in the POC.
9. Each mailbox may have at most one active session at a time.
10. Agents are registered manually on first startup through Host MCP.
11. Host polls unread mail every 10 seconds and resumes idle agents.
12. Agents should process one email per resume turn in the POC prompt model.

## Scope

### In Scope

- standardized internal email model
- Central persistence for email, delivery, thread, task, host, mailbox, and agent profile data
- Host bootstrap auth with Central
- Host MCP tools for agent registration, mail access, read-state changes, sending mail, and task actions
- explicit unread/read handling
- task completion validation tied to reply emails
- debug-friendly inspection behavior

### Out of Scope

- SMTP send/receive
- binary attachment upload
- mailbox migration automation across live hosts
- automatic bootstrap of agents that were never manually initialized
- Markdown email rendering

## Terminology

### Address Object

Use a structured address object aligned with RFC 5322 display-name plus mailbox-address semantics:

```json
{
  "display_name": "Aster",
  "address": "pm.aster@agents.local"
}
```

`from` is a single object.

`to` and `cc` are arrays of address objects.

### Email

An email is the canonical persisted mail item.

Recommended fields:

- `email_id`: internal Central primary key
- `message_id`: RFC-style message identifier
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

Rules:

- Central generates internal mail `message_id` values for POC-native mail.
- Future external mail integrations should preserve original external `message_id` values.
- `references` should be stored as a normalized string array.
- `subject` remains the canonical field name; do not use `title`.
- `body_text` and `raw_body` are plain text only in the POC.

### Delivery

Unread/read state is not stored on the email itself. It belongs to recipient delivery rows.

Recommended fields:

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

Rules:

- POC uses `delivery_id` as the primary identity for `mark_read`.
- debug/read-only inspection must not mutate delivery read state.
- only normal agent runtime calls may change read state.

### Thread

A thread is the stable conversation container built from reply linkage.

Recommended fields:

- `thread_id`
- `root_email_id`
- `root_message_id`
- `root_subject`
- `latest_email_id`
- `thread_status`
- `created_at`
- `updated_at`

Rules:

- Thread creation is based on `in_reply_to` and `references`.
- Subject alone must not merge threads.
- Two emails with the same subject but no reply linkage must create two threads.
- Later subject changes do not change thread identity.
- UI should display the first email subject as the thread subject.

### Task

Tasks are execution records attached primarily to a specific email and secondarily to a thread.

Recommended fields:

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

Rules:

- If an agent sends a delegation email and then creates a task, the task binds to the delegation email, not the original incoming email.
- A task cannot be marked `done` until the assignee has sent a reply email and provided `completed_by_email_id`.
- Central must validate:
  - `completed_by_email_id` belongs to the same thread
  - the reply sender matches the current task assignee
  - the reply email was created after the task was created

### Linked Resources

The POC does not support direct attachment upload. Agents only send linked resources.

Recommended shape:

```json
{
  "url": "https://example.com/file.pdf",
  "title": "Spec Draft",
  "mime_type": "application/pdf",
  "size_bytes": 1024
}
```

This can live as `linked_resources[]` or `attachments[]` in the email model.

## System Responsibilities

### Central

Central is the source of truth for:

- host records
- mailbox bindings
- agent profiles
- emails
- deliveries
- threads
- tasks
- linked resources
- auth tokens and token revocation state

Central is also responsible for:

- generating internal `message_id`
- computing thread assignment from reply linkage
- validating task completion via `completed_by_email_id`
- enforcing one active mailbox session at a time
- rejecting mailbox conflicts when a mailbox is still active on another healthy host
- preserving debug/read-only inspection without read-state side effects

### Host

Host is a thin local runtime bridge.

Host responsibilities:

- exchange bootstrap key for host token
- register itself with Central
- maintain Central heartbeat
- expose local MCP tools only after successful Central auth/registration
- expose MCP config instructions through logs and `GET /mcp-config`
- poll unread mail for managed mailboxes every 10 seconds
- resume mailbox sessions when unread mail exists and the mailbox is idle
- avoid resuming a mailbox that is already running
- retry failed resumes with exponential backoff up to 3 times
- mark mailbox unavailable after repeated failure or invalid token

Host is not responsible for:

- interpreting mail content into product meaning
- auto-bootstrapping brand-new agents
- silently marking mail as read

### Agent

Agent responsibilities:

- perform first manual bootstrap with operator-provided profile data
- create its local `AGENTS.md` at workspace root on first startup
- register through Host MCP so Host can forward the profile to Central
- explicitly mark deliveries as read through MCP
- read one email per resume turn in the POC prompt contract
- send receipt/reply mail even when no task is needed
- explicitly create tasks through Host MCP when delegation or execution tracking is needed
- send reply mail before marking tasks done

## Agent Profile Model

Each agent has a persisted profile with:

- `name`
- `mailbox`
- `role`
- `responsibilities`
- `status`

Rules:

- `responsibilities` follow a role plus fixed-responsibility template pattern.
- POC discovery only needs to return `mailbox`, `name`, `role`, and `status`.
- If mailbox identity or name changes, treat the result as a new agent identity.
- Old identities should move to `retired`.
- `retired` mailboxes may read history but may not send new mail.

## Runtime Flows

### 1. Host Bootstrap and Auth

1. Host starts with a preconfigured bootstrap key.
2. Host exchanges the bootstrap key for a long-lived revocable host token.
3. Host registers itself with Central.
4. Host begins heartbeat to Central every 5 seconds.
5. Only after successful auth and registration may Host expose MCP.
6. Host prints MCP setup instructions and serves `GET /mcp-config`.

Rules:

- if Host misses or fails 5 consecutive Central heartbeat checks, it is considered offline
- if token validation fails or the token is revoked, Host must stop exposing MCP and mark managed mailboxes unavailable

### 2. First Manual Agent Startup

1. Operator manually starts the agent session.
2. Operator provides profile information:
   - name
   - mailbox
   - role
   - responsibilities
3. Agent writes its local `AGENTS.md`.
4. Agent calls Host MCP to register its profile.
5. Host forwards the profile to Central.
6. Central adds the mailbox/profile to the discoverable agent list.

Rules:

- agents that were never manually bootstrapped are not registered
- unregistered agents must not receive mail
- Host must not auto-bootstrap unknown agents

### 3. Incoming Email Ingestion

1. Central receives a new email from a human, internal agent, or future external source.
2. Central assigns or creates a thread using `in_reply_to` and `references`.
3. Central persists the email.
4. Central creates one delivery row per recipient.
5. Deliveries start as `unread`.

Rules:

- POC currently enforces one primary `to` recipient
- `cc` recipients are stored but do not drive current task logic

### 4. Host Polling and Resume

1. Every 10 seconds, Host checks Central for unread deliveries for its managed mailboxes.
2. If a mailbox has unread deliveries and no running session, Host resumes that mailbox session.
3. If a mailbox is already running, new unread mail waits for a later cycle.
4. The prompt should instruct the agent to process one email per resume turn.
5. When multiple unread deliveries exist, process FIFO by oldest receive time.

Rules:

- Host drives `resume session`, not new-session fanout
- one mailbox has one active session at a time
- duplicate processing after Host crash is acceptable in the POC

### 5. Reading and Marking Read

1. Agent fetches unread mail through Host MCP.
2. Agent decides how to act.
3. Agent explicitly calls `mark_read(delivery_id)` through MCP.

Rules:

- no implicit read marking during fetch
- debug/read-only fetches must not mark read

### 6. Delegation and Task Creation

1. Agent sends an internal delegation email through Host MCP.
2. Agent explicitly calls task creation through Host MCP.
3. Host forwards the request to Central.
4. Central creates a task bound to the delegation email and related thread.

Rules:

- email is the primary collaboration object
- task is the structured execution record that follows the email

### 7. Task Completion

1. Agent sends its completion or progress reply email.
2. Agent calls task status update with `completed_by_email_id`.
3. Central validates the completion rules.
4. If validation passes, Central marks the task `done`.

Rules:

- reply-first, status-second
- no task may be completed only by changing status without a reply email

### 8. Debug and Human Intervention

Debug behavior is allowed in the POC for development and inspection.

Rules:

- debug/read-only calls must be explicitly flagged
- debug reads must not affect unread state
- debug access may inspect all mailboxes and threads during the POC
- debug access should be logged distinctly from normal agent runtime traffic

### 9. Failure and Recovery

If a resume fails:

1. Host retries with exponential backoff.
2. Host stops after 3 failed attempts.
3. Host marks the mailbox failed.
4. Human operator re-logs Host and performs manual cleanup before recovery.

Mailbox binding rules:

- at any moment, a mailbox may only be active on one Host
- POC does not support automatic mailbox migration
- if a Host restarts, mailbox binding resets and the agent must register again if needed
- if another Host attempts to claim a still-live mailbox, Central should reject the claim until the old binding expires or is manually cleared

## Minimum Central API Groups

Exact route names may still evolve, but the POC needs these Central capabilities:

- host bootstrap auth
- host registration
- host heartbeat
- mailbox binding and unbinding
- agent profile registration and discovery
- create/send email
- list unread deliveries for a mailbox
- mark delivery read
- get thread detail
- get email detail
- create task
- update task status with `completed_by_email_id`
- debug/read-only inspection APIs

## Minimum Host MCP Surface

Exact tool names may still evolve, but the POC needs these Host MCP capabilities:

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

Host should also expose non-MCP thin APIs:

- `GET /health`
- `GET /status`
- `GET /mcp-config`

## Idempotency

The POC requires idempotency protection for side-effecting actions.

At minimum:

- sending email must be idempotent
- creating tasks must be idempotent

Central should own canonical deduplication behavior. Exact request handshake and parameter naming can be finalized in the API contract phase.

## POC Constraints

- `to` is modeled as an array but POC should enforce one primary recipient
- `cc` exists in the model but does not participate in task routing
- draft support is not implemented in the first POC flow; only send behavior is required
- binary attachments are not uploaded; only linked resources are supported
- no automatic first-time agent bootstrap
- no automatic mailbox migration
- no subject-only thread merge

## Follow-up Design Work

This document is sufficient to start the next design pass for:

- data model revision
- Central API contract revision
- Host MCP contract revision
- prompt revision for one-email-per-resume behavior
- implementation plan updates
