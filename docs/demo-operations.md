# Local Test Environment RUNBOOK

## Goal

This runbook starts the current local Agent Mail test environment exactly as the repository works today:

- PostgreSQL via `docker compose`
- Central API on `http://localhost:3000`
- Host daemon on `http://localhost:8788`
- Web UI on `http://localhost:5173`

Use this path when you want to interact with the system manually. Use `pnpm validate:phase10` when you want the full formal proof path.

## Prerequisites

- `Node.js >= 24`
- `pnpm`
- Docker Desktop or OrbStack
- `codex` CLI installed if you want Host-managed agent turns to execute real work
- `gh auth status` passing if you want artifact metadata to include GitHub repository and PR data

## One-Time Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy env files:

```bash
cp apps/central/.env.example apps/central/.env
cp apps/host/.env.example apps/host/.env
```

3. Create a local Host config:

```bash
cp apps/host/host.example.toml apps/host/host.local.toml
```

4. Edit `apps/host/host.local.toml`:

- set `machine_id` and `label` for this machine
- keep one mailbox per agent identity you want to run locally
- set each `workspace_path` to a real writable git checkout or worktree

Recommended shape:

```toml
machine_id = "mac-local"
label = "Mac Local"

[[mailboxes]]
mailbox = "pm.aster@agents.local"
name = "Aster"
role = "pm"
workspace_path = "/absolute/path/to/pm-worktree"
git_user_name = "Aster"
git_user_email = "pm.aster@agents.local"

[[mailboxes]]
mailbox = "backend.coda@agents.local"
name = "Coda"
role = "backend"
workspace_path = "/absolute/path/to/backend-worktree"
git_user_name = "Coda"
git_user_email = "backend.coda@agents.local"
```

Notes:

- Do not point multiple artifact-producing mailboxes at the same writable checkout unless you intentionally want them sharing one worktree.
- For end-to-end testing, separate worktrees are the safer default.

## Start The Stack

Open three terminals after the database is ready.

### 1. Start PostgreSQL

```bash
docker compose up -d postgres
```

### 2. Apply migrations

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/agent_mail pnpm db:migrate
```

### 3. Start Central

Terminal A:

```bash
pnpm dev:central
```

Expected:

- Central listens on `http://localhost:3000`

### 4. Start Host

Terminal B:

```bash
HOST_CONFIG_PATH=apps/host/host.local.toml pnpm dev:host
```

Expected:

- Host listens on `http://localhost:8788`
- the machine and configured mailboxes register with Central

### 5. Start Web

Terminal C:

```bash
pnpm dev:web
```

Expected:

- Web listens on `http://localhost:5173`
- `/api` requests proxy to Central on `http://localhost:3000`

## Ready Checks

Run these once the three services are up:

```bash
curl http://localhost:3000/api/v1/health
curl http://localhost:8788/health
curl http://localhost:8788/status
curl http://localhost:3000/api/v1/machines
curl http://localhost:3000/api/v1/mailboxes
```

Open:

```text
http://localhost:5173
```

The Web UI should show:

- compose-thread form
- thread list and thread detail
- task list for the selected thread
- host list
- session list
- session detail with clear-session action

## Manual Usage Loop

1. Open the Web UI.
2. Create a thread addressed to a mailbox that exists in `apps/host/host.local.toml`, for example `pm.aster@agents.local`.
3. Write a task that either:
- asks for a direct answer
- asks PM to delegate to another local mailbox such as `backend.coda@agents.local`
4. Watch the thread, tasks, hosts, and sessions update.
5. If Codex is installed and the Host sees pending mailbox work, it will automatically choose `codex exec` or `codex exec resume`.

## Formal Proof Path

Use this when you want the repo’s full automated verification path instead of the manual stack above:

```bash
pnpm validate:phase10
```

For temp logs, workspaces, and the final JSON report:

```bash
pnpm validate:phase10 -- --keep-temp
```

## Stop The Environment

1. Press `Ctrl-C` in the Central, Host, and Web terminals.
2. Stop PostgreSQL:

```bash
docker compose down
```

Optional cleanup:

```bash
rm -f .agent-mail/host-state.json
```

## Troubleshooting

- If Host starts but no agent work happens, check that `codex --version` succeeds.
- If Host cannot register mailboxes correctly, verify `HOST_CONFIG_PATH` and every `workspace_path`.
- If Web loads but data is empty, verify Central is reachable at `http://localhost:3000` and that Vite is still running.
- If artifact rows are missing `repository` or `pr_link`, check `gh auth status`. Local branch and commit metadata still work without GitHub auth, but GitHub fields may be null.
- If the database is stale, rerun:

```bash
docker compose down -v
docker compose up -d postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/agent_mail pnpm db:migrate
```
