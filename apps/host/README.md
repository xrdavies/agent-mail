# Agent Host

Machine-local daemon for mailbox registration, local session registry, heartbeat, and runtime status.

It also owns:

- local MCP exposure at `/mcp`
- mailbox pending-work detection
- automatic `codex exec` vs `codex exec resume` decisions
- session summary and last-processed-message persistence

## Local run

1. Copy the env template:

   ```bash
   cp apps/host/.env.example apps/host/.env
   ```

2. Adjust `apps/host/host.example.toml` or point `HOST_CONFIG_PATH` at another TOML file.

3. Start the daemon:

   ```bash
   pnpm dev:host
   ```

4. Register the Host MCP endpoint with Codex:

   ```bash
   codex mcp add agent-mail-host --url http://localhost:8788/mcp
   ```

5. Inspect the local surfaces:

   - `GET /health`
   - `GET /status`
   - `/mcp`

## Runtime behavior

When the daemon is running, it periodically:

1. refreshes machine and session heartbeats
2. checks local mailboxes for pending tasks
3. runs `codex exec` when a mailbox has no active session
4. runs `codex exec resume <session_id>` when a mailbox already has one

For host-managed turns, the MCP endpoint is injected automatically into the Codex command line. The manual `codex mcp add` step is only needed when you want to start an interactive Codex session yourself and bootstrap it through the same local MCP bridge.
