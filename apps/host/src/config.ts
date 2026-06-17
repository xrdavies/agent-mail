import path from "node:path";

import { z } from "zod";

const managedMailboxSchema = z.object({
  mailbox: z.string().email(),
  workspacePath: z.string().min(1),
  gitUserName: z.string().min(1),
  gitUserEmail: z.string().email(),
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  responsibilities: z.string().min(1).optional()
});

const hostConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(8788),
  host: z.string().min(1).default("127.0.0.1"),
  publicBaseUrl: z.string().url().optional(),
  centralBaseUrl: z.string().url().default("http://127.0.0.1:3000"),
  hostId: z.string().min(1).default("mac-local"),
  label: z.string().min(1).default("Mac Local"),
  hostVersion: z.string().min(1).default("0.1.0"),
  bootstrapKey: z.string().min(1).default("agent-mail-dev-bootstrap"),
  statePath: z.string().min(1).default(path.resolve("apps/host/state/agent-mail-host.sqlite")),
  heartbeatIntervalMs: z.coerce.number().int().positive().default(5_000),
  pollIntervalMs: z.coerce.number().int().positive().default(10_000),
  resumeMaxFailures: z.coerce.number().int().positive().default(3),
  resumeBackoffBaseMs: z.coerce.number().int().positive().default(5_000),
  resumeDangerouslyBypass: z.coerce.boolean().default(true),
  resumeCommandTemplate: z.string().min(1).optional(),
  managedMailboxes: z.array(managedMailboxSchema).default([])
});

export type ManagedMailboxConfig = z.infer<typeof managedMailboxSchema>;
export type HostConfig = z.infer<typeof hostConfigSchema>;

function parseManagedMailboxes(raw: string | undefined): ManagedMailboxConfig[] {
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  return z.array(managedMailboxSchema).parse(parsed);
}

export function loadHostConfig(env: NodeJS.ProcessEnv = process.env): HostConfig {
  return hostConfigSchema.parse({
    port: env.HOST_PORT,
    host: env.HOST_HOST,
    publicBaseUrl: env.HOST_PUBLIC_BASE_URL,
    centralBaseUrl: env.CENTRAL_BASE_URL,
    hostId: env.HOST_ID,
    label: env.HOST_LABEL,
    hostVersion: env.HOST_VERSION,
    bootstrapKey: env.HOST_BOOTSTRAP_KEY,
    statePath: env.HOST_STATE_PATH,
    heartbeatIntervalMs: env.HOST_HEARTBEAT_INTERVAL_MS,
    pollIntervalMs: env.HOST_POLL_INTERVAL_MS,
    resumeMaxFailures: env.HOST_RESUME_MAX_FAILURES,
    resumeBackoffBaseMs: env.HOST_RESUME_BACKOFF_BASE_MS,
    resumeDangerouslyBypass: env.HOST_RESUME_DANGEROUSLY_BYPASS,
    resumeCommandTemplate: env.HOST_RESUME_COMMAND_TEMPLATE,
    managedMailboxes: parseManagedMailboxes(env.HOST_MANAGED_MAILBOXES_JSON)
  });
}
