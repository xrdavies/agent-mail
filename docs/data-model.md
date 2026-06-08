# Agent Mail Data Model

## Purpose

This document defines the canonical data model for the current Agent Mail POC.

It exists to support:

- schema design
- API contract design
- Agent Host design
- session continuity via `codex exec resume`
- Web visibility of hosts, mailboxes, sessions, threads, and tasks

This is the logical data model. It is not tied to a specific ORM shape or migration implementation.

## Modeling Principles

1. Mailbox is the stable identity boundary.
2. Task is the execution boundary.
3. Thread is the communication boundary.
4. Session belongs to a mailbox, not directly to a task, in the POC.
5. GitHub artifact references are persisted in Agent Mail, but GitHub remains the artifact truth layer.
6. A machine may host multiple mailboxes.
7. A mailbox may only be bound to one active session at a time in the POC.

## Core Entities

The POC requires these entities:

- `Machine`
- `Mailbox`
- `Session`
- `Thread`
- `Message`
- `Task`
- `Artifact`

## Entity: Machine

Represents one machine that runs an Agent Host.

### Fields

- `machine_id`
  - type: string
  - unique
  - immutable
- `label`
  - type: string
  - human-readable machine name
- `host_version`
  - type: string
  - optional
- `host_status`
  - enum:
    - `online`
    - `offline`
    - `degraded`
- `last_heartbeat_at`
  - timestamp
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### Notes

- one machine may host multiple mailboxes
- machine status is set by Agent Host heartbeat behavior

## Entity: Mailbox

Represents one agent identity.

### Fields

- `mailbox`
  - type: string
  - unique
  - canonical identity key
- `name`
  - type: string
  - human-readable codename
- `role`
  - enum or constrained string
  - examples:
    - `pm`
    - `tech_lead`
    - `backend`
    - `frontend`
    - `smart_contract`
    - `qa`
    - `security`
    - `ops`
- `machine_id`
  - foreign key to `Machine.machine_id`
  - nullable only if mailbox is temporarily unassigned
- `workspace_path`
  - type: string
  - machine-local path
- `git_user_name`
  - type: string
- `git_user_email`
  - type: string
- `mailbox_status`
  - enum:
    - `active`
    - `disabled`
    - `unassigned`
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### Notes

- mailbox identity is explicit in MCP tools during the POC
- mailbox is the stable owner of a long-lived Codex session

## Entity: Session

Represents one mailbox-scoped Codex working session.

### Fields

- `session_id`
  - type: string
  - unique
- `mailbox`
  - foreign key to `Mailbox.mailbox`
- `machine_id`
  - foreign key to `Machine.machine_id`
- `workspace_path`
  - type: string
  - copied from mailbox binding at bootstrap time
- `session_status`
  - enum:
    - `bootstrapping`
    - `idle`
    - `running`
    - `waiting_human`
    - `waiting_child`
    - `failed`
    - `cleared`
- `active_task_id`
  - foreign key to `Task.task_id`
  - nullable
- `last_processed_message_id`
  - foreign key to `Message.message_id`
  - nullable
- `latest_summary`
  - type: text
  - nullable
- `last_heartbeat_at`
  - timestamp
- `started_at`
  - timestamp
- `cleared_at`
  - timestamp
  - nullable
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### Notes

- in the POC, a mailbox may have at most one non-cleared session at a time
- sessions are cleared manually

## Entity: Thread

Represents one mail conversation.

### Fields

- `thread_id`
  - type: UUID/string
  - unique
- `subject`
  - type: string
- `created_by_type`
  - enum:
    - `human`
    - `agent`
- `created_by_id`
  - type: string
  - `human-user` or mailbox
- `assigned_mailbox`
  - foreign key to `Mailbox.mailbox`
  - the mailbox that owns the primary task
- `thread_status`
  - enum:
    - `open`
    - `waiting_human`
    - `waiting_agent`
    - `completed`
    - `blocked`
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### Notes

- `thread_status` is an optional but recommended derived field in the POC
- thread is the communication container, not the execution container

## Entity: Message

Represents one mail event inside a thread.

### Fields

- `message_id`
  - type: UUID/string
  - unique
- `thread_id`
  - foreign key to `Thread.thread_id`
- `from_type`
  - enum:
    - `human`
    - `agent`
- `from_id`
  - type: string
  - `human-user` or mailbox
- `to_type`
  - enum:
    - `human`
    - `agent`
    - nullable
- `to_id`
  - type: string
  - nullable
- `body`
  - type: text
- `message_kind`
  - enum:
    - `human_mail`
    - `agent_reply`
    - `delegation_mail`
    - `summary_mail`
    - `system_note`
  - optional in early implementation, but strongly recommended
- `created_at`
  - timestamp

### Notes

- `delegation_mail` is especially valuable for showing agent-to-agent coordination in Web
- messages are append-only

## Entity: Task

Represents one execution assignment anchored to a thread.

### Fields

- `task_id`
  - type: UUID/string
  - unique
- `title`
  - type: string
- `thread_id`
  - foreign key to `Thread.thread_id`
  - nullable only for exceptional cases
- `parent_task_id`
  - foreign key to `Task.task_id`
  - nullable
- `created_by_type`
  - enum:
    - `human`
    - `agent`
- `created_by_id`
  - type: string
  - `human-user` or mailbox
- `assignee_type`
  - enum:
    - `human`
    - `agent`
- `assignee_mailbox`
  - foreign key to `Mailbox.mailbox`
  - for agent tasks
- `status`
  - enum:
    - `new`
    - `in_progress`
    - `paused`
    - `done`
    - `blocked`
- `requires_artifact`
  - boolean
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### Notes

- `requires_artifact = true` means the task is expected to produce concrete repository output
- parent tasks may be paused while child tasks are running

## Entity: Artifact

Represents one declared repository output.

### Fields

- `artifact_id`
  - type: UUID/string
  - unique
- `task_id`
  - foreign key to `Task.task_id`
- `mailbox`
  - foreign key to `Mailbox.mailbox`
- `artifact_type`
  - enum:
    - `document`
    - `script`
    - `code`
    - `config`
    - `test`
    - `other`
- `path`
  - type: string
- `branch`
  - type: string
  - nullable
- `commit_sha`
  - type: string
  - nullable
- `created_at`
  - timestamp

### Notes

- the artifact record lives in Agent Mail
- the actual file truth lives in GitHub

## Relationships

### Machine -> Mailbox

- one-to-many

### Mailbox -> Session

- one-to-many historically
- at most one active session in the POC

### Thread -> Message

- one-to-many

### Thread -> Task

- one-to-many

### Task -> Task

- self-referential parent/child relationship

### Task -> Artifact

- one-to-many

## Key Invariants

These rules should hold in the POC:

1. A mailbox may have at most one non-cleared session at a time.
2. A session belongs to exactly one mailbox.
3. A mailbox session is bound to one fixed workspace path during its lifetime.
4. A task belongs to at most one parent task.
5. A message always belongs to exactly one thread.
6. If a task has `requires_artifact = true`, it must not be considered complete without at least one valid artifact record or equivalent validated artifact signal.
7. Child tasks under the same parent must share the same `thread_id` as the parent.
8. Manual session clearing removes the active mailbox -> session binding but preserves session metadata for debugging and audit.

## Recommended Status Semantics

## Machine.host_status

- `online`
  - heartbeat is fresh
- `degraded`
  - heartbeat is present but recent failures exist
- `offline`
  - heartbeat is stale or absent

## Mailbox.mailbox_status

- `active`
  - mailbox can receive work
- `disabled`
  - mailbox should not receive work
- `unassigned`
  - mailbox exists but is not currently mapped to a machine

## Session.session_status

- `bootstrapping`
  - first session registration in progress
- `idle`
  - session exists and is not actively running a turn
- `running`
  - a Codex turn is in progress
- `waiting_human`
  - last action requires human reply
- `waiting_child`
  - waiting for child task completion
- `failed`
  - last resume/bootstrap failed
- `cleared`
  - session was manually cleared and is no longer active

## Thread.thread_status

- `open`
  - normal active collaboration
- `waiting_human`
  - thread currently expects human input
- `waiting_agent`
  - thread currently expects agent work
- `completed`
  - collaboration is complete
- `blocked`
  - collaboration is blocked

## Task.status

- `new`
  - newly created and eligible for pickup
- `in_progress`
  - currently being worked
- `paused`
  - intentionally suspended, often due to child task creation
- `done`
  - completed
- `blocked`
  - cannot proceed without intervention or missing artifact

## Suggested Derived Queries

The system will benefit from these derived views:

- mailbox pending work queue
- sessions by host
- active sessions by mailbox
- thread latest message summary
- thread child-task completion summary
- artifact-producing tasks missing artifact records

## Suggested Indexes

At minimum, index:

- `Mailbox.machine_id`
- `Session.mailbox`
- `Session.machine_id`
- `Session.session_status`
- `Thread.assigned_mailbox`
- `Thread.updated_at`
- `Message.thread_id, created_at`
- `Task.assignee_mailbox, status, updated_at`
- `Task.parent_task_id`
- `Task.thread_id`
- `Artifact.task_id`

## Bootstrap-Specific Data Needs

The bootstrap path requires:

- mailbox lookup
- workspace path binding
- session creation metadata

Therefore:

- `Mailbox.workspace_path` must exist before normal resume operations
- `Session.workspace_path` should capture the resolved value used at bootstrap time

## Manual Cleanup-Specific Data Needs

Manual cleanup should preserve:

- `session_id`
- `mailbox`
- `workspace_path`
- `latest_summary`
- `last_processed_message_id`
- `cleared_at`

This allows later debugging even after the active binding is removed.

## Open Modeling Questions

1. Should `thread_status` be explicitly stored or derived?
2. Should `message_kind` be explicit now or later?
3. Should artifact validation require rows in `Artifact`, or is message-based `Artifacts:` parsing sufficient in the first implementation slice?
4. Should `workspace_path` live only on `Mailbox`, or also be snapshotted on `Session` for historical audit?
