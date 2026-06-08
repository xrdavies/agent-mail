# Demo RUNBOOK

## Goal

This runbook describes the default local demo loop for the Agent Mail POC: start a clean stack, verify that it is healthy, optionally run the Codex smoke path, and stop everything cleanly.

## Prerequisites

- `Node.js 24`
- `pnpm`
- Docker or Docker Desktop
- Codex CLI installed locally if you want to run `pnpm smoke:codex`

The default local environment values live in `.env.example`:

- `DATABASE_URL=postgres://postgres:postgres@localhost:5432/agent_mail`
- `APP_ORIGIN=http://localhost:5173`
- `PORT=3001`
- `VITE_API_URL=http://localhost:3001`

## Recommended Daily Flow

1. Install dependencies once:

   ```bash
   pnpm install
   ```

2. Stop anything stale before a fresh demo:

   ```bash
   pnpm demo:stop
   ```

3. Start the full demo stack:

   ```bash
   pnpm demo:start
   ```

4. In another terminal, verify the stack is up:

   ```bash
   pnpm demo:status
   ```

5. Optionally run the end-to-end Codex + MCP smoke flow:

   ```bash
   pnpm smoke:codex
   ```

Keep the `pnpm demo:start` terminal open while the demo is running.

## Command Reference

### `pnpm demo:start`

This command now runs through `scripts/demo-start.mjs` and performs the full bootstrap in a fixed order:

- starts PostgreSQL with `pnpm db:up`
- reapplies migrations and reseeds demo data via `pnpm demo:reset`
- launches the API, web app, and three long-lived agent workers in the foreground

When startup reaches the long-running phase, the script prints:

- Web: `http://localhost:5173`
- API: `http://localhost:3001`
- Health: `http://localhost:3001/health`

### `pnpm demo:status`

Use this as the fast verification path. It exits non-zero if the API is unreachable and prints:

- API health
- thread count
- task count
- task status distribution
- task assignee distribution

### `pnpm smoke:codex`

Use this as the deep verification path when you need to prove MCP connectivity and real Codex task execution against the local API.

### `pnpm demo:reset`

Use this when you need a clean inbox with seeded data. It reapplies migrations and resets the demo dataset back to:

- default agent identities
- one backend thread
- one PM thread
- one QA thread

For the cleanest result, prefer stopping and restarting the full stack instead of resetting while workers are still active:

```bash
pnpm demo:stop
pnpm demo:start
```

### `pnpm demo:stop`

This stops:

- API dev processes
- web dev processes
- long-lived agent worker processes
- the local PostgreSQL container

## Manual Fallback

If you need to bring the stack up step by step instead of using `pnpm demo:start`, use this order:

1. `pnpm install`
2. `pnpm db:up`
3. `pnpm db:migrate`
4. `pnpm db:seed`
5. `pnpm dev:api`
6. `pnpm dev:web`
7. `pnpm dev:agents`

## Expected Ready State

After a clean start:

- the web app is available at `http://localhost:5173`
- the API health endpoint responds at `http://localhost:3001/health`
- `pnpm demo:status` reports seeded threads and tasks
- the seeded agents are `backend-agent`, `qa-agent`, and `pm-agent`

## Troubleshooting

- If `pnpm demo:status` fails right after startup, wait a few seconds and rerun it. The API may still be compiling.
- If the start flow fails during database bootstrap, run `docker compose ps` and then `pnpm demo:stop` before retrying.
- If `pnpm smoke:codex` fails, confirm the API is healthy first and that the local Codex CLI is installed.
