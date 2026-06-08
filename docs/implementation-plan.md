# Agent Mail Implementation Plan

## Purpose

This document defines the implementation plan for the current Agent Mail POC architecture.

It translates the architecture and prompt documents into an execution sequence for engineering work.

It is intentionally implementation-oriented:

- what to build first
- what depends on what
- what each phase must produce
- how to know a phase is complete

This plan assumes the current source of truth documents are:

- [System Architecture](./system-architecture.md)
- [Technical Stack](./tech-stack.md)
- [Prompt Specification](./prompt-specification.md)

## Planning Principles

1. Build the control plane before the UI that depends on it.
2. Build the mailbox/session registry before `resume` orchestration.
3. Build local Agent Host capabilities before relying on them in the Web product.
4. Prefer one narrow end-to-end slice that works over many partial slices.
5. Keep the current one-mailbox-one-session POC constraint unless a phase explicitly changes it.

## Scope Assumptions

This implementation plan is for the POC architecture only.

Included:

- mailbox-scoped sessions
- cross-machine mailbox routing
- Agent Host
- local MCP bridge
- bootstrap flow
- `codex exec` / `codex exec resume`
- work package and delta APIs
- thread-visible delegation
- manual session clear
- GitHub-backed artifact reporting

Excluded for now:

- production auth and RBAC
- advanced scheduling optimization
- task-scoped sessions
- final product-grade Host UI
- queue infrastructure
- enterprise deployment concerns

## Current State Baseline

What already exists in the repo and may be reused:

- central thread/message/task UI
- Hono backend
- shared schema package
- demo bootstrap scripts
- basic agent worker ideas

What should be treated as transitional rather than final:

- current worker loop
- current artifact heuristics
- current MCP surface
- current pseudo-host behavior

The target architecture takes precedence over existing implementation shortcuts.

## Target Deliverables

By the end of this plan, the POC should support:

1. a mailbox is assigned to a machine and workspace
2. a first session can be bootstrapped manually
3. later turns resume the same mailbox session
4. the session pulls its own work package through local MCP
5. humans can see hosts and sessions in the Web UI
6. humans can manually clear a session
7. artifact-producing tasks can report Git-backed outputs

## Workstreams

There are five parallel workstreams, but they should be implemented in a specific order:

1. Central data and control plane
2. Agent Host daemon
3. Local MCP layer
4. Resume orchestration
5. Web observability and operator controls

## Phase 0: Design Lock

### Objective

Freeze the architecture and prompt model so implementation does not drift.

### Inputs

- `system-architecture.md`
- `prompt-specification.md`

### Tasks

- confirm mailbox naming and role set
- confirm one-mailbox-one-session rule
- confirm manual cleanup rule
- confirm GitHub artifact model
- confirm explicit mailbox parameter rule for MCP tools

### Output

- architecture and prompt documents accepted as the baseline

### Completion signal

- the team agrees implementation should follow these documents without introducing competing designs

## Phase 1: Central Data Model and Registry Layer

### Objective

Add the missing control-plane objects to the central backend.

### Required models

- `Machine`
- `Mailbox`
- `Session`
- `Thread`
- `Message`
- `Task`
- `Artifact`

### Tasks

- finalize schema fields for machine/mailbox/session/artifact
- add database migrations
- model mailbox -> machine binding
- model mailbox -> session binding
- model workspace path on mailbox/session
- model session status
- model `last_processed_message_id`
- model `latest_summary`
- model `requiresArtifact`

### Output

- migrated database schema
- seed data updated for expanded agent set
- central persistence layer for machine/mailbox/session

### Dependencies

- none beyond Phase 0

### Completion signal

- central database can persist mailbox, machine, session, task, and artifact state together
- tests can create and read these objects

## Phase 2: Central API Contract

### Objective

Expose the architecture through stable central APIs.

### API groups

#### Collaboration APIs

- create thread
- reply to thread
- create child task
- update task status
- list threads/tasks/messages

#### Session/registry APIs

- register machine
- register mailbox
- bind mailbox to session
- heartbeat session
- query session state
- clear session

#### Context APIs

- list mailbox tasks
- get task work package
- get thread delta
- get full thread
- list known agents

### Tasks

- define request/response payloads
- implement backend handlers
- define status transitions
- add tests for registry and context APIs

### Output

- central API contract implemented and tested

### Dependencies

- Phase 1

### Completion signal

- the central backend can serve all mailbox, session, thread, task, and work-package operations required by Agent Host and Web

## Phase 3: Agent Host Daemon

### Objective

Introduce a real machine-local Agent Host service.

### Responsibilities to implement

- load local host config
- register machine identity
- register local mailboxes
- maintain heartbeat
- persist mailbox -> session_id mapping locally
- know each mailbox workspace path
- know each mailbox Git identity

### Tasks

- design host config format
- implement host startup
- implement mailbox registration
- implement heartbeat loop
- implement local session registry storage
- implement local status endpoint or CLI status command

### Output

- one Agent Host process per machine
- local mailbox/session/workspace state managed by the host

### Dependencies

- Phase 1
- Phase 2

### Completion signal

- a host can start, register itself, expose local mailbox state, and persist session binding metadata

## Phase 4: Local MCP Layer

### Objective

Make Codex sessions consume local MCP instead of talking to the central system directly.

### Tool groups

#### Bootstrap tools

- `bootstrap_session(mailbox, role, name, workspacePath)`
- `get_runtime_context(mailbox)`

#### Runtime tools

- `list_mailbox_tasks(mailbox)`
- `get_task_work_package(mailbox, taskId)`
- `get_thread_delta(mailbox, threadId, sinceMessageId)`
- `get_full_thread(mailbox, threadId)`
- `reply_thread(mailbox, threadId, body, toMailbox?)`
- `create_child_task(mailbox, threadId, title, toMailbox, body, requiresArtifact)`
- `update_task_status(mailbox, taskId, status)`
- `list_agents(mailbox)`

### Tasks

- implement local MCP server in Agent Host
- forward runtime calls to central APIs
- log `caller_session_id` and `declared_mailbox`
- validate bootstrap/session binding flow

### Output

- Codex sessions can work entirely through local MCP

### Dependencies

- Phase 2
- Phase 3

### Completion signal

- a manually started Codex session can bootstrap itself through local MCP and then use local MCP for task/thread work

## Phase 5: Session Bootstrap and Resume Orchestration

### Objective

Replace one-shot worker behavior with mailbox-scoped session continuity.

### Tasks

- implement first-session bootstrap path
- persist `codex_session_id`
- implement host-side decision: `exec` vs `resume`
- detect mailbox pending work
- resume the correct mailbox session
- persist `last_processed_message_id`
- persist `latest_summary`
- handle failed resume attempts

### Output

- mailbox-scoped durable session flow

### Dependencies

- Phase 3
- Phase 4

### Completion signal

- a mailbox receives work
- the same session continues across multiple turns
- a second turn does not create a fresh Codex session unnecessarily

## Phase 6: Work Package and Delta Flow

### Objective

Prevent full-thread replay from becoming the default runtime behavior.

### Tasks

- implement `get_task_work_package`
- implement `get_thread_delta`
- define `latest_summary`
- define `last_processed_message_id` update rules
- update resume logic to rely on work package first

### Output

- session continuity uses structured deltas instead of full thread replay

### Dependencies

- Phase 2
- Phase 5

### Completion signal

- resumed turns can continue with only new deltas and a structured work package

## Phase 7: Web Operator Views

### Objective

Expose enough runtime state for humans to inspect and intervene.

### Required views

- Hosts list
- Sessions list
- Session detail

### Required fields

- agent name
- role
- mailbox
- workspace path
- owning host
- machine label
- session id
- session status
- active task count
- latest processed message timestamp
- latest summary

### Required actions

- view session details
- copy workspace path
- clear session

### Output

- Web can show where a mailbox runs and what session it is using

### Dependencies

- Phase 1
- Phase 2
- Phase 3
- Phase 5

### Completion signal

- a human can identify which machine and workspace correspond to a mailbox session

## Phase 8: Manual Session Clear

### Objective

Implement the chosen cleanup policy: fully manual clear.

### Tasks

- add `Clear Session` operator action in Web
- add clear-session central API
- add host-side session unbind logic
- preserve summary and metadata
- mark session `cleared`

### Important note

Do not depend on interactive `/new`.
Logical unbinding is sufficient for the POC.

### Output

- human-controlled session cleanup

### Dependencies

- Phase 3
- Phase 7

### Completion signal

- a human can clear a mailbox session and a later task can bootstrap/resume a new one cleanly

## Phase 9: Git Artifact Discipline

### Objective

Make artifact-producing work observable and attributable through Git.

### Tasks

- bind mailbox to Git identity
- standardize branch/worktree strategy
- persist artifact metadata
- require artifact reporting for `requiresArtifact=true`
- verify artifact existence before done when feasible

### Output

- repository outputs are attributable to the mailbox that produced them

### Dependencies

- Phase 1
- Phase 3
- Phase 5

### Completion signal

- artifact-producing tasks can point to concrete paths, branches, or commits owned by the correct mailbox identity

## Phase 10: End-to-End Scenario Validation

### Objective

Prove the architecture against realistic collaboration flows.

### Required scenarios

1. human -> PM -> child tasks -> PM summary
2. human follow-up on the same thread -> same mailbox session resume
3. artifact-producing backend task -> file output + artifact report
4. manual session clear -> later re-bootstrap/resume
5. host visibility in Web

### Output

- validated POC behavior

### Dependencies

- Phases 1 through 9

### Completion signal

- the system behaves according to architecture using real mailbox-scoped session continuity

## Suggested Build Order

Implement in this order:

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8
9. Phase 9
10. Phase 10

## Acceptance Criteria

The implementation plan is complete when:

- central registry objects exist and are tested
- Agent Host exists as a real daemon
- local MCP is functional
- mailbox sessions can bootstrap and resume
- work package/delta APIs are used
- hosts and sessions are visible in Web
- sessions can be cleared manually
- artifact-producing work can be traced to Git outputs
- multi-turn mail collaboration is demonstrated end-to-end

## Immediate Next Documents

After this implementation plan, the next documents to add are:

1. `data-model.md`
2. `agent-host-design.md`
3. `api-contract.md`
