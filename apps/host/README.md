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

4. Inspect the local status surface:

   - `GET /health`
   - `GET /status`
