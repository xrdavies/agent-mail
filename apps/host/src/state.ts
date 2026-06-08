import { SESSION_STATUSES, isoTimestampSchema } from "@agent-mail/shared";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

import type { HostConfig } from "./config.js";

const persistedSessionSchema = z.object({
  session_id: z.string().min(1),
  workspace_path: z.string().min(1),
  session_status: z.enum(SESSION_STATUSES),
  active_task_id: z.string().min(1).nullable(),
  last_processed_message_id: z.string().min(1).nullable(),
  latest_summary: z.string().nullable(),
  last_heartbeat_at: isoTimestampSchema.nullable(),
  started_at: isoTimestampSchema,
  cleared_at: isoTimestampSchema.nullable()
});

const persistedMailboxStateSchema = z.object({
  mailbox: z.string().min(1),
  current_session: persistedSessionSchema.nullable(),
  recent_cleared_sessions: z.array(persistedSessionSchema)
});

export const hostStateSchema = z.object({
  machine_id: z.string().min(1),
  updated_at: isoTimestampSchema,
  mailboxes: z.record(z.string(), persistedMailboxStateSchema)
});

export type PersistedSessionState = z.infer<typeof persistedSessionSchema>;
export type PersistedMailboxState = z.infer<typeof persistedMailboxStateSchema>;
export type HostState = z.infer<typeof hostStateSchema>;

const createEmptyMailboxState = (mailbox: string): PersistedMailboxState => ({
  mailbox,
  current_session: null,
  recent_cleared_sessions: []
});

const createInitialState = (config: HostConfig): HostState => ({
  machine_id: config.machine_id,
  updated_at: new Date().toISOString(),
  mailboxes: Object.fromEntries(
    config.mailboxes.map((mailbox) => [mailbox.mailbox, createEmptyMailboxState(mailbox.mailbox)])
  )
});

const reconcileState = (state: HostState, config: HostConfig): HostState => {
  const nextMailboxes = { ...state.mailboxes };

  for (const mailbox of config.mailboxes) {
    nextMailboxes[mailbox.mailbox] ??= createEmptyMailboxState(mailbox.mailbox);
  }

  return {
    machine_id: config.machine_id,
    updated_at: new Date().toISOString(),
    mailboxes: nextMailboxes
  };
};

export class HostStateStore {
  constructor(private readonly statePath: string) {}

  async load(config: HostConfig): Promise<HostState> {
    try {
      const source = await readFile(this.statePath, "utf8");
      const parsed = hostStateSchema.parse(JSON.parse(source));

      if (parsed.machine_id !== config.machine_id) {
        throw new Error(
          `State file machine_id ${parsed.machine_id} does not match config machine_id ${config.machine_id}.`
        );
      }

      const reconciled = reconcileState(parsed, config);
      await this.save(reconciled);
      return reconciled;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      const initialState = createInitialState(config);
      await this.save(initialState);
      return initialState;
    }
  }

  async save(state: HostState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

