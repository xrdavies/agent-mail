# Agent Mail System Architecture

## Purpose

This document defines the complete POC system architecture for Agent Mail.

It is a self-contained architecture description for the current direction:

- mail/thread collaboration as the primary interaction model
- one long-lived Codex session per agent mailbox during the POC
- `codex exec` for first-time session creation
- `codex exec resume` for session continuity
- cross-machine execution through machine-local Agent Hosts
- GitHub as the artifact source of truth

This document is the architecture reference for the POC. It is not a product marketing note and it is not a partial implementation summary.

## Scope

This architecture is designed to validate whether Agent Mail can support real multi-turn project collaboration.

It covers:

- human-to-agent mail
- agent-to-agent mail
- task delegation and parent/child tasks
- mailbox-based identity
- cross-machine agent execution
- persistent mailbox sessions
- local MCP access from Codex sessions
- Git-backed artifact production
- human observation and manual session clearing

It does not attempt to solve:

- enterprise-grade auth and RBAC
- multi-tenant isolation
- advanced scheduling optimization
- production HA / distributed queues
- final product-grade Agent Host UI
- task-scoped sessions

## Non-Goals

The POC does not aim to prove:

- a complete autonomous software organization
- zero-human-oversight operation
- final cloud deployment architecture
- broad support for arbitrary external integrations

The POC aims to prove:

1. whether mail/thread collaboration is usable in real development work
2. whether mailbox-scoped session continuity materially improves collaboration
3. whether humans can observe and intervene effectively
4. whether agents can produce visible artifacts, not just messages

## Architecture Principles

1. **Mailbox is the stable agent identity.**
2. **Task is the execution unit.**
3. **Thread is the communication unit.**
4. **Agent Mail Central is the source of truth for collaboration state.**
5. **GitHub is the source of truth for code/document/script artifacts.**
6. **Agent Host manages runtime state, not business meaning.**
7. **Codex sessions retrieve their own context through local MCP.**
8. **Session continuity is mailbox-scoped in the POC.**
9. **Session clearing is manual in the POC.**

## Top-Level Topology

```text
Human Web Client
    |
    v
Agent Mail Central
    |
    +------------------------+------------------------+
    |                        |                        |
    v                        v                        v
Agent Host on Mac A      Agent Host on Mac B      Agent Host on Mac C
    |                        |                        |
    v                        v                        v
Local MCP Server         Local MCP Server         Local MCP Server
    |                        |                        |
    v                        v                        v
Codex Session(s)         Codex Session(s)         Codex Session(s)
    |                        |                        |
    +------------------------+------------------------+
                             |
                             v
                           GitHub
```

## Component Model

## 1. Human Web Client

The Web client is the human operator interface.

Responsibilities:

- compose mail
- inspect threads
- inspect tasks
- inspect hosts and sessions
- reply to existing threads
- manually clear sessions

It is not responsible for:

- direct Codex orchestration
- session lifecycle management
- interpreting local machine state

## 2. Agent Mail Central

Agent Mail Central is the collaboration control plane and persistence layer.

Responsibilities:

- mailboxes
- machines
- sessions
- threads
- messages
- tasks
- task parent/child relationships
- wake-up eligibility
- work package generation
- thread delta generation

It is not responsible for:

- spawning Codex locally
- reading local workspaces
- direct repo execution

## 3. Agent Host

Agent Host is a machine-local runtime supervisor.

There is one Agent Host per participating machine.

Responsibilities:

- register local machine identity with Agent Mail Central
- expose machine-local mailbox availability
- store mailbox -> session bindings for this machine
- keep heartbeats alive
- detect which local mailboxes have pending work
- start a first Codex session with `codex exec`
- resume an existing Codex session with `codex exec resume`
- expose local MCP tools for local Codex sessions
- perform manual session clear when explicitly requested

It is not responsible for:

- understanding thread meaning
- building business summaries
- deciding which message matters semantically
- deciding technical feasibility

## 4. Codex Session

Each Codex session is a mailbox-scoped working session during the POC.

Responsibilities:

- identify as a mailbox
- call local MCP tools
- inspect task/work-package/thread context
- reason about the current work
- reply in-thread
- create child tasks
- update task status
- create repository artifacts when required

It is not responsible for:

- choosing its own machine
- choosing its own workspace
- scheduling itself
- clearing itself automatically

## 5. GitHub

GitHub is the artifact truth layer.

Responsibilities:

- persist code/document/script output
- expose agent-authored commit history
- serve as the canonical artifact record across machines

It is not the source of truth for:

- mail state
- task state
- session state

## Cross-Machine Model

The POC assumes multiple Macs may participate.

Example:

- Mac A: human interaction and optionally some agents
- Mac B: PM or technical leadership mailboxes
- Mac C: specialist engineering mailboxes

Important rule:

- humans do not need to know where an agent runs in order to use mail
- the system does need to know where a mailbox currently lives

Therefore Agent Mail Central must model:

- which machine hosts a mailbox
- which machine owns a session

## Identity Model

Each agent mailbox has:

- `mailbox`
- `name`
- `role`
- `machine_id`
- `workspace_path`

Recommended mailbox format:

```text
<role>.<name>@agents.local
```

Examples:

- `pm.aster@agents.local`
- `tech.atlas@agents.local`
- `backend.coda@agents.local`
- `frontend.mira@agents.local`
- `smart-contract.forge@agents.local`
- `qa.nova@agents.local`
- `security.sentinel@agents.local`
- `ops.harbor@agents.local`

## Session Model

### POC decision

- one long-lived Codex session per mailbox
- mailbox-scoped continuity
- no task-scoped session layer yet

This is a conscious POC tradeoff:

- better observability
- easier manual intervention
- simpler `exec resume` adoption

at the cost of:

- some long-lived context contamination risk

## Workspace Model

Each mailbox session is bound to one fixed local workspace/worktree during the POC.

Recommended invariant:

```text
mailbox -> session -> workspace
```

This improves:

- repo continuity
- Git predictability
- resume stability
- human debugging

## Source of Truth

### Agent Mail Central is the source of truth for:

- mailbox registry
- machine registry
- session registry
- threads
- messages
- tasks
- task states
- mailbox ownership

### GitHub is the source of truth for:

- repository artifacts
- branches
- commits
- merge state
- delivery outputs

### Agent Host is the source of truth for:

- current machine-local runtime health
- current local session process state
- workspace binding enforcement on this machine

## Data Model

The following logical entities are required.

## Machine

Represents a machine running an Agent Host.

Suggested fields:

- `machine_id`
- `label`
- `host_status`
- `last_heartbeat_at`
- `reachable`

## Mailbox

Represents one agent identity.

Suggested fields:

- `mailbox`
- `name`
- `role`
- `machine_id`
- `workspace_path`
- `git_user_name`
- `git_user_email`

## Session

Represents one mailbox-scoped Codex working session.

Suggested fields:

- `session_id`
- `mailbox`
- `machine_id`
- `workspace_path`
- `status`
- `active_task_id`
- `last_processed_message_id`
- `last_heartbeat_at`
- `latest_summary`
- `created_at`
- `updated_at`

## Thread

Represents a communication thread.

Suggested fields:

- `thread_id`
- `subject`
- `created_by`
- `assigned_mailbox`
- `created_at`
- `updated_at`

## Message

Represents one mail item in a thread.

Suggested fields:

- `message_id`
- `thread_id`
- `from_mailbox` or human sender
- `to_mailbox` or human recipient
- `body`
- `created_at`

## Task

Represents an execution assignment attached to a thread.

Suggested fields:

- `task_id`
- `thread_id`
- `parent_task_id`
- `created_by`
- `assignee_mailbox`
- `status`
- `requires_artifact`
- `created_at`
- `updated_at`

## Artifact

Represents declared repository output.

Suggested fields:

- `artifact_id`
- `task_id`
- `mailbox`
- `type`
- `path`
- `branch`
- `commit_sha`
- `created_at`

## Startup and Bootstrap Flow

## Why bootstrap exists

The POC needs a practical path to start mailbox sessions on arbitrary machines while keeping the human in control of workspace selection.

## Bootstrap sequence

1. Human manually starts a first Codex session on a chosen machine.
2. Human supplies:
   - mailbox
   - role
   - name
   - workspace path
3. The session calls local MCP bootstrap tools.
4. Agent Host stores:
   - mailbox binding
   - session id
   - workspace path
5. All future work for that mailbox uses `codex exec resume`.

## Important rule

The session does not autonomously choose its workspace.

The workspace is human-selected during bootstrap, and the host enforces that binding afterward.

## Runtime Flow

## New Thread

1. Human creates a thread in Web.
2. Agent Mail Central creates:
   - thread
   - first message
   - primary task
3. The assigned mailbox becomes eligible for wake-up.
4. The owning Agent Host resumes or creates the mailbox session.
5. The Codex session calls local MCP to fetch its current work.

## Human Follow-Up

1. Human replies in an existing thread.
2. Agent Mail Central appends the message.
3. If the reply requires action, Agent Mail Central reopens or creates the relevant task.
4. Agent Host sees the mailbox has work.
5. The same mailbox session is resumed.

## Child Task Completion

1. A child task is completed.
2. Agent Mail Central checks whether the parent task can wake.
3. If all required child tasks are done, the parent task becomes eligible again.
4. The parent mailbox session is resumed.

## Session Continuity

The session continuity unit is the mailbox.

The Host does not decide work meaning.
It only decides:

- does this mailbox have work?
- do I already have a session id?
- should I `exec` or `resume`?

## Context Strategy

### Core rule

The Codex session should not read the full thread by default.

Preferred sequence:

1. `list_mailbox_tasks(mailbox)`
2. `get_task_work_package(mailbox, taskId)`
3. `get_thread_delta(mailbox, threadId, sinceMessageId)`
4. `get_full_thread(mailbox, threadId)` only when necessary

### Reason

- lowers token cost
- reduces stale context
- improves long-thread stability

## MCP Boundary

The Codex session should talk only to local MCP tools exposed by the local Agent Host.

The local MCP tools then talk to Agent Mail Central.

### Why this boundary exists

- Codex sessions should not need direct knowledge of public/tunnel/central API addresses
- credentials stay at the Host layer
- network boundary changes do not require changing each session
- debug becomes easier

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

### Mailbox rule

Mailbox is explicit in MCP tool parameters during the POC.

This is intentional because it:

- keeps identity visible to the session
- makes debug simpler
- allows controlled inspection of mailbox state

### Host logging recommendation

The local Agent Host should log at least:

- caller session id
- declared mailbox
- requested tool
- timestamp

## Artifact Strategy

### Current POC rule

If a task explicitly requires repository output:

- set `requires_artifact = true`
- the executing agent must create or modify real files
- the reply must include:

```text
Artifacts: path/to/file1, path/to/file2
```

If no valid artifact paths are reported, the task should not be considered complete.

## Git Strategy

### Source of truth

GitHub is the artifact truth layer.

### Identity

Each mailbox uses its own Git identity:

- `git config user.name`
- `git config user.email`

### POC collaboration assumptions

- different agents may work in separate repositories or separate directories/worktrees
- merge conflicts are handled through normal Git workflows
- agents are responsible for completing their own Git operations when they change repository state

### Recommended branch pattern

```text
agent-mail/<mailbox>/<task-id>
```

## Human Intervention Model

The POC must support human observation and manual intervention.

Supported interventions:

- reply in-thread
- direct a follow-up to a mailbox
- manually inspect a mailbox session
- manually clear a mailbox session

## Web Visibility Model

The Web UI should provide:

- Agent Hosts list
- Sessions list

Each session row should show at least:

- agent name
- mailbox
- role
- workspace path
- owning host
- session status
- active task count
- latest processed message timestamp

This is sufficient for the POC even without a full Host UI.

## Session Cleanup

For this POC, cleanup is manual.

Rules:

- the session remains alive until a human explicitly clears it
- the Agent Host performs the cleanup
- the session does not self-clear

### Cleanup action

When a human clears a session, the host should:

1. stop future resumes for the current session id
2. mark the session `cleared`
3. unbind `mailbox -> session_id`
4. preserve latest summary and metadata

No interactive `/new` flow is required for the POC.

## Agent Role Set

Recommended POC roles:

- Human
- PM Agent
- Tech Lead Agent
- Backend Agent
- Frontend Agent
- Smart Contract Agent
- QA Agent
- Security Agent
- Ops Agent

### Human

Responsibilities:

- discuss requirements
- clarify direction
- approve or reject proposals
- continue thread discussion

### PM Agent

Responsibilities:

- intake
- clarification
- coordination
- minimal delegation
- final synthesis back to human

### Tech Lead Agent

Responsibilities:

- feasibility analysis
- solution shaping
- technical delegation

### Backend Agent

Responsibilities:

- backend analysis
- backend implementation
- API/data model/script delivery

### Frontend Agent

Responsibilities:

- UI/interaction implementation
- frontend repository changes

### Smart Contract Agent

Responsibilities:

- EVM contract architecture
- contract implementation
- deployment/script support

### QA Agent

Responsibilities:

- validation
- acceptance review
- test planning

### Security Agent

Responsibilities:

- threat modeling
- security review
- mitigation guidance

### Ops Agent

Responsibilities:

- delivery planning
- deployment readiness
- operational support

## Prompting

Prompting is defined in a dedicated prompt specification document:

- [Prompt Specification](./prompt-specification.md)

The system architecture does not redefine prompt text.
All runtime and role prompts should follow the prompt specification document.

## Rollout Order

### Phase 1

- mailbox identity
- mailbox-scoped sessions
- bootstrap
- Agent Host heartbeat
- `exec resume`
- local MCP boundary
- thread-visible delegation

### Phase 2

- work package / delta APIs
- host/session visibility in Web
- manual clear session flow
- Git artifact verification

### Phase 3

- recovery improvements
- richer observability
- broader role usage

## Open Questions

1. Should mailbox sessions eventually evolve to task-scoped sessions after POC validation?
2. What exact human-operated controls should be exposed for clearing a session?
3. Should debug access across mailboxes remain unrestricted during the POC?
4. How should work-package summaries be compacted over long-running mailbox sessions?
