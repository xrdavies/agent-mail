# Agent Mail Data Model

## Purpose

This document defines the canonical data model for the next email-oriented Agent Mail POC.

It exists to support:

- Central schema design
- Host orchestration design
- API contract design
- session continuity via `codex exec resume`
- future SMTP and internet-email compatibility

This document supersedes the earlier generic `thread/message` model for the next implementation slice.

## Modeling Principles

1. Mailbox-address identity is the stable collaboration boundary.
2. Email is the primary communication object.
3. Delivery is the per-recipient state object.
4. Thread groups emails by reply linkage, not by subject-only heuristics.
5. Task is attached primarily to a triggering email and secondarily to a thread.
6. Host is the runtime boundary; agent profile is the identity/profile boundary.
7. A mailbox may only be active on one Host at a time.
8. A mailbox may only have one active session at a time in the POC.
9. Read state must not live on the email row itself.
10. Repository delivery artifacts and email-linked resources are different concepts and should not be merged.

## Canonical Terminology

### Address Object

Agent Mail should use an RFC 5322-aligned structured address object:

```json
{
  "display_name": "Aster",
  "address": "pm.aster@agents.local"
}
```

Rules:

- `from` is one address object
- `to` is an array of address objects
- `cc` is an array of address objects
- the POC stores arrays for future compatibility
- the POC runtime enforces exactly one primary `to` recipient
- raw RFC-style header strings may be preserved separately for display, replay, and future SMTP compatibility

## Core Entities

The email-oriented POC requires these entities:

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

## Entity: Host

Represents one local Agent Host daemon instance registered with Central.

### Fields

- `host_id`
  - type: string
  - unique
  - stable host identity
- `label`
  - type: string
  - human-readable host name
- `host_version`
  - type: string
  - optional
- `host_status`
  - enum:
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

### Notes

- this replaces earlier `Machine` language for the next POC slice
- one Host may manage multiple active mailbox bindings
- Host must authenticate successfully before exposing MCP

## Entity: HostToken

Represents the long-lived Central-issued token for one Host.

### Fields

- `token_id`
  - type: string
  - unique
- `host_id`
  - foreign key to `Host.host_id`
- `token_hash`
  - type: string
  - Central should not store raw tokens
- `token_status`
  - enum:
    - `active`
    - `revoked`
- `issued_at`
  - timestamp
- `revoked_at`
  - timestamp
  - nullable
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### Notes

- bootstrap keys are only used for exchange and are not the normal runtime credential
- POC uses one long-lived revocable token per Host

## Entity: AgentProfile

Represents one registered agent identity/profile record.

### Fields

- `agent_id`
  - type: string
  - unique
- `mailbox`
  - type: string
  - mailbox address, for example `pm.aster@agents.local`
- `name`
  - type: string
- `role`
  - constrained string
  - examples:
    - `pm`
    - `tech_lead`
    - `backend`
    - `frontend`
    - `smart_contract`
    - `qa`
    - `security`
    - `ops`
- `responsibilities`
  - type: text
  - fixed role-shaped profile description in the POC
- `profile_status`
  - enum:
    - `active`
    - `retired`
    - `unavailable`
- `registered_by_host_id`
  - foreign key to `Host.host_id`
- `created_at`
  - timestamp
- `updated_at`
  - timestamp
- `retired_at`
  - timestamp
  - nullable

### Notes

- mailbox and name changes are treated as a new agent identity in the POC
- old profiles move to `retired` and remain queryable
- only one non-retired profile should exist for a mailbox at a time
- `retired` agents may read historical information but may not send new email

## Entity: MailboxBinding

Represents the current host-local ownership of an active mailbox identity.

### Fields

- `binding_id`
  - type: string
  - unique
- `agent_id`
  - foreign key to `AgentProfile.agent_id`
- `mailbox`
  - type: string
  - mailbox snapshot
- `host_id`
  - foreign key to `Host.host_id`
- `workspace_path`
  - type: string
  - writable local workspace/worktree path
- `git_user_name`
  - type: string
- `git_user_email`
  - type: string
- `binding_status`
  - enum:
    - `active`
    - `inactive`
    - `failed`
- `bound_at`
  - timestamp
- `unbound_at`
  - timestamp
  - nullable
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### Notes

- a mailbox may only have one active binding at a time
- if another Host tries to claim a still-live binding, Central must reject it
- Host restart may reset bindings in the POC and require re-registration

## Entity: Session

Represents one mailbox-scoped long-lived Codex session.

### Fields

- `session_id`
  - type: string
  - unique
- `mailbox`
  - type: string
  - mailbox snapshot
- `host_id`
  - foreign key to `Host.host_id`
- `workspace_path`
  - type: string
  - resolved path used for bootstrap
- `session_status`
  - enum:
    - `bootstrapping`
    - `idle`
    - `running`
    - `failed`
    - `cleared`
- `active_task_id`
  - foreign key to `Task.task_id`
  - nullable
- `last_processed_delivery_id`
  - foreign key to `Delivery.delivery_id`
  - nullable
- `latest_summary`
  - type: text
  - nullable
- `started_at`
  - timestamp
- `last_heartbeat_at`
  - timestamp
- `cleared_at`
  - timestamp
  - nullable
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### Notes

- one mailbox may have at most one non-cleared session at a time
- Host uses `resume session` instead of starting new sessions for every unread email

## Entity: Thread

Represents a stable conversation thread built from reply linkage.

### Fields

- `thread_id`
  - type: string
  - unique
- `root_email_id`
  - foreign key to `Email.email_id`
- `root_message_id`
  - type: string
- `root_subject`
  - type: string
- `latest_email_id`
  - foreign key to `Email.email_id`
  - nullable
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

- thread assignment is based on `in_reply_to` and `references`
- subject must not be used as the primary merge key
- if reply linkage is missing, Central creates a new thread in the POC
- UI should display the first email subject as the thread subject

## Entity: Email

Represents one persisted email item.

### Fields

- `email_id`
  - type: string
  - unique
- `message_id`
  - type: string
  - unique
- `thread_id`
  - foreign key to `Thread.thread_id`
- `from`
  - structured address object
- `to`
  - array of structured address objects
- `cc`
  - array of structured address objects
- `subject`
  - type: string
- `body_text`
  - type: text
- `raw_body`
  - type: text
- `raw_headers`
  - type: object
  - optional raw header preservation, for example:
    - `from`
    - `to`
    - `cc`
    - `subject`
- `in_reply_to`
  - type: string
  - nullable
- `references`
  - type: array of strings
- `email_kind`
  - enum:
    - `human_inbound`
    - `agent_reply`
    - `agent_delegation`
    - `agent_receipt`
    - `system_note`
- `send_state`
  - enum:
    - `draft`
    - `sent`
    - `failed`
- `created_by_host_id`
  - foreign key to `Host.host_id`
  - nullable
- `created_by_mailbox`
  - type: string
  - nullable
- `sent_at`
  - timestamp
  - nullable
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### Notes

- Central generates internal `message_id` values for POC-native email
- future SMTP ingress/egress should preserve external `message_id` where applicable
- the POC only needs the send path operationally, but `send_state` should still reserve `draft`
- `cc` is preserved for compatibility but does not participate in task routing in the POC
- `raw_headers` may preserve original header strings when Central or a future mail connector needs exact replay fidelity

## Entity: Delivery

Represents one recipient-specific delivery state for an email.

### Fields

- `delivery_id`
  - type: string
  - unique
- `email_id`
  - foreign key to `Email.email_id`
- `thread_id`
  - foreign key to `Thread.thread_id`
- `recipient_address`
  - type: string
- `recipient_mailbox`
  - type: string
  - nullable for future external recipients
- `delivery_kind`
  - enum:
    - `to`
    - `cc`
- `read_status`
  - enum:
    - `unread`
    - `read`
- `read_at`
  - timestamp
  - nullable
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### Notes

- unread/read is tracked at the delivery layer, not on `Email`
- agents must explicitly mark deliveries read through MCP
- debug reads must not mutate `read_status`

## Entity: Task

Represents one execution record created from an email context.

### Fields

- `task_id`
  - type: string
  - unique
- `thread_id`
  - foreign key to `Thread.thread_id`
- `trigger_email_id`
  - foreign key to `Email.email_id`
- `parent_task_id`
  - foreign key to `Task.task_id`
  - nullable
- `created_by_email_id`
  - foreign key to `Email.email_id`
  - nullable
- `created_by_mailbox`
  - type: string
- `assignee_mailbox`
  - type: string
- `title`
  - type: string
- `instructions`
  - type: text
  - nullable
- `requires_artifact`
  - boolean
- `status`
  - enum:
    - `new`
    - `in_progress`
    - `paused`
    - `done`
    - `blocked`
- `completed_by_email_id`
  - foreign key to `Email.email_id`
  - nullable
- `created_at`
  - timestamp
- `updated_at`
  - timestamp

### Notes

- task is email-first and thread-second
- if an agent sends a delegation email and then creates a task, `trigger_email_id` must point to that delegation email
- a task cannot be marked `done` without a valid `completed_by_email_id`

## Entity: LinkedResource

Represents a link-style attachment attached to an email.

### Fields

- `linked_resource_id`
  - type: string
  - unique
- `email_id`
  - foreign key to `Email.email_id`
- `url`
  - type: string
- `title`
  - type: string
  - nullable
- `mime_type`
  - type: string
  - nullable
- `size_bytes`
  - type: integer
  - nullable
- `created_at`
  - timestamp

### Notes

- the POC does not support binary upload attachments
- agents send links only

## Entity: Artifact

Represents one repository output produced for a task.

### Fields

- `artifact_id`
  - type: string
  - unique
- `task_id`
  - foreign key to `Task.task_id`
- `produced_by_mailbox`
  - type: string
- `repository`
  - type: string
  - nullable
- `path`
  - type: string
- `branch`
  - type: string
  - nullable
- `commit_sha`
  - type: string
  - nullable
- `pr_link`
  - type: string
  - nullable
- `created_at`
  - timestamp

### Notes

- `Artifact` is for repository delivery outputs
- `LinkedResource` is for email-linked materials
- these should remain separate

## Key Invariants

1. A mailbox may only have one active Host binding at a time.
2. A mailbox may only have one non-cleared session at a time.
3. Every email belongs to exactly one thread.
4. Thread assignment is driven by `in_reply_to` and `references`.
5. Subject-only matching must not merge threads.
6. POC send flows must enforce exactly one primary `to` recipient even though the field is modeled as an array.
7. Every email delivery has its own unread/read lifecycle.
8. Delivery read state must not change during debug/read-only inspection.
9. A task must reference both `thread_id` and `trigger_email_id`.
10. `Task.trigger_email_id` must belong to the same thread as `Task.thread_id`.
11. A task may only be marked `done` if `completed_by_email_id` is:
    - on the same thread
    - sent by the current assignee mailbox
    - created later than the task itself
12. A `retired` mailbox may not send new email.
13. `LinkedResource` rows are email-scoped, not task-scoped.
14. `Artifact` rows are task-scoped, not email-scoped.

## Recommended Derived Views

- unread deliveries by mailbox, oldest first
- active mailbox bindings by Host
- active sessions by mailbox
- thread latest-email summary
- pending tasks by mailbox
- delegated tasks by trigger email
- retired agent history lookup
- failed mailboxes awaiting manual recovery

## Recommended Indexes

At minimum, index:

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

## Open Follow-on Work

This model is enough to start the next implementation pass, but later phases may still refine:

1. whether draft persistence should become active rather than reserved
2. how external SMTP ingress maps to `recipient_mailbox = null` deliveries
3. whether idempotency requires a dedicated persistence entity or can stay request-scoped
