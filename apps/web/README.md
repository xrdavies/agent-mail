# Agent Mail Web

Operator-facing web surface for host and session observability.

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

- Hosts list
- Sessions list
- Session detail
- Clear Session action
