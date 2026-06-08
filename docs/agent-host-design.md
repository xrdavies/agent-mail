# Agent Host Design

## Purpose

This document defines the POC design for Agent Host.

Agent Host is the machine-local runtime supervisor that enables mailbox-scoped Codex sessions across multiple Macs.

This document should be read together with:

- [System Architecture](./system-architecture.md)
- [Implementation Plan](./implementation-plan.md)
- [Data Model](./data-model.md)
- [API Contract](./api-contract.md)
- [Prompt Specification](./prompt-specification.md)

## Role of Agent Host

Agent Host is a machine-local background service.

It is responsible for:

- machine registration
- mailbox ownership registration
- local mailbox/session/workspace state
- heartbeat
- local MCP exposure
- first-session bootstrap support
- `codex exec` / `codex exec resume` decisions
- manual session clear execution

It is not responsible for:

- interpreting thread semantics
- deciding business meaning
- generating high-level summaries on behalf of Codex
- deciding feasibility of user requests

## Process Form

For the POC, Agent Host should be:

- one long-running process per machine
- started explicitly by the operator or local startup tooling
- independent of the Web process

It does not need a standalone UI in the POC.
Its state is surfaced through Agent Mail Web.

## Deployment Assumption

One Agent Host runs on each participating machine.

Examples:

- Mac A -> Agent Host A
- Mac B -> Agent Host B
- Mac C -> Agent Host C

Each host owns a subset of mailboxes.

## Local Ownership Model

Each host loads a local mailbox roster from configuration.

For each local mailbox, the host must know:

- `mailbox`
- `name`
- `role`
- `workspace_path`
- `git_user_name`
- `git_user_email`

The host is the source of truth for:

- which mailboxes exist on this machine
- which workspace each mailbox uses on this machine

## Runtime Responsibilities

Agent Host has seven main runtime responsibilities.

### 1. Load configuration

At startup, the host should load:

- `machine_id`
- `label`
- local mailbox roster
- workspace paths
- Git identities

### 2. Register with Agent Mail Central

At startup, the host should:

- register the machine
- register or refresh local mailbox ownership

### 3. Maintain local session registry

The host should store:

- mailbox -> session binding
- local session status
- workspace binding
- last heartbeat metadata
- summary metadata

### 4. Expose local MCP tools

The host should expose all mailbox-scoped MCP tools required by Codex sessions.

### 5. Detect pending work

The host should periodically determine which local mailboxes require attention.

This means:

- detect mailbox work
- detect whether to `exec` or `resume`
- trigger the correct mailbox session

### 6. Heartbeat

The host should send:

- machine heartbeat
- session heartbeat for active sessions

### 7. Manual clear

When requested by a human operator through Agent Mail Web, the host should clear the mailbox-session binding.

## Non-Responsibilities

The host should not:

- parse thread content to decide product direction
- summarize requirements for agents
- decide how to solve technical work
- replace Codex reasoning

## Local Configuration Model

The host should read a local config file.

Recommended logical shape:

```toml
machine_id = "mac-b"
label = "Mac B"

[[mailboxes]]
mailbox = "pm.aster@agents.local"
name = "Aster"
role = "pm"
workspace_path = "/Users/me/worktrees/pm-aster"
git_user_name = "Aster"
git_user_email = "pm.aster@agents.local"

[[mailboxes]]
mailbox = "backend.coda@agents.local"
name = "Coda"
role = "backend"
workspace_path = "/Users/me/worktrees/backend-coda"
git_user_name = "Coda"
git_user_email = "backend.coda@agents.local"
```

## Configuration Rules

1. Mailbox ownership is configured locally.
2. Workspace binding is configured locally.
3. The session does not choose its own workspace.
4. Git identity is configured per mailbox.

## Local State Persistence

The host should persist local state so that restarts do not destroy mailbox/session bindings immediately.

Recommended local state:

- `machine_id`
- local mailbox roster snapshot
- mailbox -> session_id
- session status
- workspace path
- active task id
- last processed message id
- latest summary
- cleared session records

POC implementation may use:

- JSON file
- SQLite

Either is acceptable for the POC.

## Core Loops

The host should implement these internal loops.

## Loop 1: Startup Registration

On startup:

1. load local config
2. register machine with Central
3. register local mailboxes with Central
4. recover local session registry

## Loop 2: Machine Heartbeat

On a fixed cadence:

1. send machine heartbeat
2. update local host status

## Loop 3: Session Heartbeat

On a fixed cadence:

1. send active session status for local sessions
2. update `last_heartbeat_at`

## Loop 4: Pending Work Detection

On a fixed cadence:

1. determine which local mailboxes have pending work
2. check whether each mailbox already has an active session
3. choose `exec` or `resume`

This loop decides **who should wake**.
It does not decide **what the work means**.

## Loop 5: Manual Action Handling

Handle human-triggered operations such as:

- clear session
- retry failed session
- bootstrap support

## Session Registry Behavior

Each mailbox may have at most one active session in the POC.

The host should enforce:

- one active `session_id` per local mailbox
- one workspace per local mailbox session

The host should reject bootstrap conflicts unless an explicit takeover path is defined.

## Bootstrap Flow

### Trigger

Human manually starts a mailbox session for the first time on a machine.

### Codex behavior

The session uses local MCP to call:

- `bootstrap_session(mailbox, role, name, workspacePath)`
- `get_runtime_context(mailbox)`

### Host behavior

The host should:

1. validate the mailbox belongs to this machine
2. validate the provided role/name/workspace
3. bind `mailbox -> session_id`
4. persist the session record
5. return runtime context

### Failure conditions

Bootstrap should fail if:

- mailbox is unknown locally
- workspace path does not match the configured mailbox binding
- another active session already owns the mailbox and force takeover is not allowed

## Resume Flow

### Trigger sources

- new task
- reopened task
- human follow-up requiring action
- parent task reactivated after child completion

### Host behavior

For each local mailbox with work:

1. load the mailbox’s current session record
2. if no active session exists:
   - create a first run with `codex exec`
3. if a session exists:
   - run `codex exec resume <SESSION_ID>`
4. mark the local session `running`
5. update central session state

### Important boundary

The host does not build the business context itself.

The resumed Codex session must call local MCP tools to obtain:

- mailbox task list
- work package
- thread delta
- full thread if needed

## Local MCP Responsibilities

The local MCP server is a bridge between Codex sessions and Central.

### It should do

- validate mailbox parameter usage
- forward MCP actions to Central APIs
- expose runtime context
- expose bootstrap helpers
- log mailbox/session/tool usage

### It should not do

- task summarization on behalf of Codex
- independent business routing logic

## Local MCP Tools

### Bootstrap tools

- `bootstrap_session(mailbox, role, name, workspacePath)`
- `get_runtime_context(mailbox)`

### Runtime tools

- `list_mailbox_tasks(mailbox)`
- `get_task_work_package(mailbox, taskId)`
- `get_thread_delta(mailbox, threadId, sinceMessageId)`
- `get_full_thread(mailbox, threadId)`
- `reply_thread(mailbox, threadId, body, toMailbox?)`
- `create_child_task(mailbox, threadId, title, toMailbox, body, requiresArtifact)`
- `update_task_status(mailbox, taskId, status)`
- `list_agents(mailbox)`

## Workspace Enforcement

When the host launches or resumes a session, it should:

- use the mailbox’s configured workspace path
- use the mailbox’s configured Git identity
- keep that workspace fixed for the mailbox session lifetime

This is a POC constraint and should not be relaxed casually.

## Session Status Handling

The host should manage these local states:

- `bootstrapping`
- `idle`
- `running`
- `waiting_human`
- `waiting_child`
- `failed`
- `cleared`

### Expected transitions

- bootstrap starts -> `bootstrapping`
- bootstrap succeeds -> `idle`
- resume starts -> `running`
- session waits for human -> `waiting_human`
- session waits for child task completion -> `waiting_child`
- resume/bootstrap failure -> `failed`
- manual clear -> `cleared`

## Manual Session Clear

The POC uses fully manual cleanup.

### Trigger

A human operator clears a mailbox session through Agent Mail Web.

### Host behavior

1. stop future resumes for the current session
2. mark the local session `cleared`
3. unbind `mailbox -> session_id`
4. preserve latest summary and metadata

### Important note

No interactive `/new` command is required for the POC cleanup model.
Logical unbinding is sufficient.

## Logging

The host should emit structured logs for:

- startup
- config load
- machine registration
- mailbox registration
- heartbeat
- bootstrap
- resume
- MCP tool invocation
- manual clear
- runtime failures

Recommended log fields:

- `machine_id`
- `mailbox`
- `session_id`
- `workspace_path`
- `action`
- `status`
- `timestamp`

## Failure Handling

The host should handle at least:

### Central unavailable

- mark host degraded
- keep local session registry
- retry later

### Resume failure

- mark session `failed`
- preserve mailbox binding metadata
- surface failure to Web

### Bootstrap conflict

- reject or require operator takeover

### Workspace mismatch

- reject execution
- mark mailbox/session degraded

### Manual clear during active work

- require explicit operator confirmation

## Web Visibility Dependencies

The host must provide enough state for Central/Web to display:

- machine status
- local mailboxes
- session status
- workspace path
- active task count
- latest processed message timestamp
- latest summary

## Recommended Implementation Order

1. config loader
2. local state persistence
3. machine registration
4. mailbox registration
5. heartbeat loop
6. local MCP server
7. bootstrap path
8. resume path
9. manual clear path
10. status endpoint / operator visibility support

## Open Questions

1. Should local state use JSON first or jump directly to SQLite?
2. Should the host expose a local HTTP status endpoint in addition to MCP?
3. How should takeover of an already-bound mailbox be handled in the first implementation slice?
4. Should failed sessions be resumable automatically, or require explicit retry?
