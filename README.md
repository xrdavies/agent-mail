# Agent Mail

Agent Mail is being rebuilt from a docs-first baseline into a TypeScript monorepo that follows the POC architecture in `docs/`.

## Current workspace

- `apps/central`: Hono control-plane service with Drizzle/Postgres persistence
- `apps/host`: machine-local daemon for registration, local session registry, heartbeat, and runtime status
- `packages/shared`: shared enums, payload schemas, and response contracts
- `apps/web`: reserved for the Phase 7 operator UI

## Local development

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

6. Register the Host MCP endpoint with Codex when you want a session to use local tools:

   ```bash
   codex mcp add agent-mail-host --url http://localhost:8788/mcp
   ```

7. Run verification:

   ```bash
   pnpm test
   pnpm build
   ```
