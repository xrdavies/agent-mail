# Agent Mail Web

Human/operator-facing web surface for:

- composing new threads
- inspecting threads and related tasks
- replying to existing threads
- observing hosts and sessions
- clearing sessions manually

## Local run

1. Start Central:

   ```bash
   pnpm dev:central
   ```

2. Start Web:

   ```bash
   pnpm dev:web
   ```

3. Open `http://localhost:5173`.

The page currently exposes:

- Compose-thread form
- Thread list and thread detail
- Related tasks for the selected thread
- Hosts list
- Sessions list
- Session detail
- Clear Session action
