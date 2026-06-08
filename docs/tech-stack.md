# Agent Mail Technical Stack

## Purpose

This document locks the implementation technology choices for the current Agent Mail POC.

It sits below:

- [System Architecture](./system-architecture.md)
- [Implementation Plan](./implementation-plan.md)
- [Data Model](./data-model.md)
- [Agent Host Design](./agent-host-design.md)
- [API Contract](./api-contract.md)

This document answers a narrower question:

- which implementation frameworks and runtimes should be used
- which infrastructure choices are fixed for the POC
- which tools are preferred for development, testing, and repository workflow

## Selection Principles

1. Prefer a small number of runtimes.
2. Prefer one language across Central, Host, and Web where practical.
3. Prefer technologies already familiar in the earlier POC direction unless they conflict with the new architecture.
4. Prefer tools that work well on local Macs and small private setups.
5. Avoid introducing infrastructure that solves scale problems the POC does not yet have.

## Locked Choices

The following choices are fixed for the current POC.

### Runtime and Language

- `Node.js 24`
- `TypeScript`
- `pnpm workspace`

Rationale:

- one runtime across Central, Agent Host, and Web reduces coordination cost
- TypeScript keeps API models, MCP payloads, and UI contracts aligned
- Node.js 24 is already the baseline in the current environment and docs

### Central Backend

- `Hono`
- `Zod`

Rationale:

- Hono is sufficient for the Central HTTP control plane without bringing in a larger full-stack framework
- Zod is the validation layer for request/response payloads and shared schema boundaries

### Database

- `PostgreSQL`
- `Drizzle ORM`

Rationale:

- the Central system needs durable relational state for machines, mailboxes, sessions, threads, messages, tasks, and artifacts
- PostgreSQL is a good default for local development and small private deployment
- Drizzle keeps schema definitions close to TypeScript while staying lightweight

### Web Client

- `React`
- `Vite`
- `Tailwind CSS`
- `shadcn/ui`
- `TanStack Query`

Rationale:

- React + Vite is sufficient for the operator-facing Web UI
- Tailwind + shadcn/ui is enough for fast assembly of internal product surfaces
- TanStack Query is the default client-side data layer for Central API consumption

### Agent Host

- `Node.js 24`
- `TypeScript`
- `Hono` for any local HTTP/status surface if needed
- local MCP server implemented in the Host process

Rationale:

- the Host should remain close to the Central backend stack
- using the same runtime and language simplifies shared models and operational debugging
- the Host is a daemon/service, not a separate desktop application

### Agent Execution

- `Codex CLI`
- `codex exec`
- `codex exec resume`

Rationale:

- the current POC explicitly validates mailbox-scoped session continuity through resume
- the POC is not using `app-server` as the primary execution surface

### Repository and GitHub Operations

- `git`
- `gh`
- `HTTPS remotes managed through gh`

Rationale:

- local repository history is still managed by git
- GitHub account and repository operations should go through gh
- HTTPS avoids accidental reuse of unrelated SSH account routing

### Local Infrastructure

- `Docker Compose`

Rationale:

- enough for local PostgreSQL and other future local support services
- avoids introducing orchestration complexity too early

### Testing

- `Vitest`
- `Playwright`

Rationale:

- Vitest is the default for unit/integration testing in TypeScript packages and services
- Playwright is the browser-level verification tool for the Web operator flows

## Technology Allocation by Component

## 1. Agent Mail Central

- Runtime: `Node.js 24`
- Language: `TypeScript`
- HTTP framework: `Hono`
- Validation: `Zod`
- Persistence: `PostgreSQL + Drizzle`
- Tests: `Vitest`

## 2. Agent Host

- Runtime: `Node.js 24`
- Language: `TypeScript`
- Daemon shape: long-running Node process
- Local API/status surface: `Hono` if HTTP is exposed
- Local protocol for sessions: MCP server embedded in Host
- Tests: `Vitest`

## 3. Human Web Client

- Runtime: `Node.js 24`
- Language: `TypeScript`
- UI framework: `React`
- Bundler/dev server: `Vite`
- Styling: `Tailwind CSS`
- Component layer: `shadcn/ui`
- Data fetching: `TanStack Query`
- Browser tests: `Playwright`

## 4. Shared Contracts

- Language: `TypeScript`
- Validation: `Zod`

Shared packages should own:

- core type definitions
- status enums
- payload schemas
- API contract helpers where useful

## 5. GitHub Artifact Layer

- Version control: `git`
- Repository hosting: `GitHub`
- Account/repo operations: `gh`

Artifact-producing tasks should report:

- repository
- branch
- commit
- PR link if present

## Explicit Non-Choices for the POC

The following are intentionally not selected as primary technologies for this phase:

- `Next.js`
- `Redis`
- `Kafka`
- `RabbitMQ`
- `WebSocket` as the primary transport between Codex and Central
- `Codex app-server` as the main execution surface
- desktop-native Agent Host UI frameworks
- Kubernetes or similar orchestration systems

These may become relevant later, but they are outside the current POC target.

## Development Workflow Defaults

### Package Management

- use `pnpm`
- use a monorepo/workspace layout

### Repository Workflow

- use `gh` for GitHub operations
- use Conventional Commits
- push changes after verification

### Environment Strategy

- local development should work on a Mac with Node.js 24 and Docker installed
- PostgreSQL should be bootstrapped locally through Docker Compose

## Rebuild Guidance

Because the repository has been intentionally reset to a docs-first baseline, implementation should be rebuilt under this stack, not inferred from deleted prior code.

The recommended initial directory structure remains:

```text
apps/
  central/
  host/
  web/
packages/
  shared/
docs/
```

Names can be adjusted during implementation if the structure remains consistent with the architecture.

## Open Decisions Still Allowed

The following are not yet fully frozen and may be decided during implementation as long as they remain consistent with the stack above:

- the exact folder names inside `apps/`
- whether the Host exposes a local HTTP status endpoint in addition to MCP
- whether the Web uses a client-side router library and which one
- exact test folder layout and package boundaries

These are implementation details, not stack-level decisions.

## Final Rule

When implementation details conflict with old assumptions from the deleted codebase, this document wins over historical precedent.
