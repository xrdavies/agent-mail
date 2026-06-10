# Agent Mail

Agent Mail is being rebuilt from a docs-first baseline into a TypeScript monorepo that follows the POC architecture in `docs/`.

## Current workspace

- `apps/central`: Hono control-plane service with Drizzle/Postgres persistence
- `apps/host`: machine-local daemon for registration, local session registry, heartbeat, local MCP, and automatic `codex exec/resume`
- `packages/shared`: shared enums, payload schemas, and response contracts
- `apps/web`: human/operator-facing React/Vite workbench for threads, tasks, hosts, and sessions

## Local development

The default manual startup path for the current local test environment lives in [docs/demo-operations.md](/Users/m4002/Projects/agent-mail/docs/demo-operations.md:1).

The fastest script-driven local path is now:

```bash
pnpm local:start
pnpm local:status
```

For a clean local database and cleared Host session state:

```bash
pnpm local:start -- --fresh
```

1. Start PostgreSQL:

   ```bash
   docker compose up -d
   ```

2. Use the central and host env files:

   ```bash
   cp apps/central/.env.example apps/central/.env
   cp apps/host/.env.example apps/host/.env
   ```

3. Generate and apply migrations:

   ```bash
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/agent_mail pnpm db:generate
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/agent_mail pnpm db:migrate
   ```

4. Run the central service:

   ```bash
   pnpm dev:central
   ```

5. Run the host daemon in a second terminal:

   ```bash
   pnpm dev:host
   ```

6. Run the operator web UI in a third terminal:

   ```bash
   pnpm dev:web
   ```

7. If you want a manually started Codex session to use the same local MCP bridge, register the Host MCP endpoint with Codex:

   ```bash
   codex mcp add agent-mail-host --url http://localhost:8788/mcp
   ```

The Host daemon now also injects this MCP endpoint automatically when it launches `codex exec` and `codex exec resume` for pending mailbox work.

8. Run verification:

   ```bash
   pnpm test
   pnpm build
   ```

9. Run the formal end-to-end validation flow:

   ```bash
   pnpm validate:phase10
   ```

`validate:phase10` is now the default proof path for the implementation plan. It provisions a temporary validation stack, drives the mailbox/session scenarios from Phase 10, validates the operator web surface, and writes a final JSON report.

Use:

```bash
pnpm validate:phase10 -- --keep-temp
```

when you want to keep the temporary workspaces, logs, and report on disk for debugging.
