# Agent Mail

Agent Mail is being rebuilt from a docs-first baseline into a TypeScript monorepo that follows the POC architecture in `docs/`.

## Current workspace

- `apps/central`: Hono control-plane service with Drizzle/Postgres persistence
- `packages/shared`: shared enums, payload schemas, and response contracts
- `apps/host`: reserved for the Phase 3 Agent Host daemon
- `apps/web`: reserved for the Phase 7 operator UI

## Local development

1. Start PostgreSQL:

   ```bash
   docker compose up -d
   ```

2. Use the central env file:

   ```bash
   cp apps/central/.env.example apps/central/.env
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

5. Run verification:

   ```bash
   pnpm test
   pnpm build
   ```
