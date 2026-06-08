# Agent Host

Machine-local daemon for mailbox registration, local session registry, heartbeat, and runtime status.

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
