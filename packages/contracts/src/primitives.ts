import { z } from "zod";

export const isoTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime());

export const identifierSchema = z.string().min(1);
export const mailboxSchema = z.string().email();
export const messageIdSchema = z.string().min(1);
export const hostStatusSchema = z.enum([
  "online",
  "offline",
  "degraded",
  "auth_failed"
]);
export const tokenStatusSchema = z.enum(["active", "revoked"]);
export const profileStatusSchema = z.enum([
  "active",
  "retired",
  "unavailable"
]);
export const bindingStatusSchema = z.enum(["active", "inactive", "failed"]);
export const mailboxRuntimeStatusSchema = z.enum([
  "bootstrapping",
  "idle",
  "running",
  "failed",
  "cleared"
]);
export const threadStatusSchema = z.enum([
  "open",
  "waiting_human",
  "waiting_agent",
  "completed",
  "blocked"
]);
export const emailKindSchema = z.enum([
  "human_inbound",
  "agent_reply",
  "agent_delegation",
  "agent_receipt",
  "system_note"
]);
export const sendStateSchema = z.enum(["draft", "sent", "failed"]);
export const readStatusSchema = z.enum(["unread", "read"]);
export const taskStatusSchema = z.enum([
  "new",
  "in_progress",
  "paused",
  "done",
  "blocked"
]);
export const taskMutableStatusSchema = z.enum([
  "in_progress",
  "paused",
  "done",
  "blocked"
]);
export const deliveryKindSchema = z.enum(["to", "cc"]);

export const addressObjectSchema = z.object({
  display_name: z.string().min(1),
  address: mailboxSchema
});

export const rawHeadersSchema = z
  .object({
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
    cc: z.string().min(0).optional(),
    subject: z.string().min(1).optional()
  })
  .catchall(z.string());

export const linkedResourceInputSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).nullable().optional(),
  mime_type: z.string().min(1).nullable().optional(),
  size_bytes: z.number().int().nonnegative().nullable().optional()
});

export const artifactInputSchema = z.object({
  repository: z.string().min(1).nullable().optional(),
  path: z.string().min(1),
  branch: z.string().min(1).nullable().optional(),
  commit_sha: z.string().min(1).nullable().optional(),
  pr_link: z.string().url().nullable().optional()
});

export type AddressObject = z.infer<typeof addressObjectSchema>;
export type ArtifactInput = z.infer<typeof artifactInputSchema>;
export type LinkedResourceInput = z.infer<typeof linkedResourceInputSchema>;
