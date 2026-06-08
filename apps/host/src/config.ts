import { registerMailboxRequestSchema } from "@agent-mail/shared";
import { readFile } from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";

export const hostMailboxConfigSchema = registerMailboxRequestSchema.omit({
  machine_id: true
});

export const hostConfigSchema = z
  .object({
    machine_id: z.string().min(1),
    label: z.string().min(1),
    mailboxes: z.array(hostMailboxConfigSchema).min(1)
  })
  .superRefine((config, ctx) => {
    const seenMailboxes = new Set<string>();

    for (const mailbox of config.mailboxes) {
      if (seenMailboxes.has(mailbox.mailbox)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate mailbox in host config: ${mailbox.mailbox}`,
          path: ["mailboxes"]
        });
      }

      seenMailboxes.add(mailbox.mailbox);
    }
  });

export type HostMailboxConfig = z.infer<typeof hostMailboxConfigSchema>;
export type HostConfig = z.infer<typeof hostConfigSchema>;

export const loadHostConfig = async (configPath: string): Promise<HostConfig> => {
  const source = await readFile(configPath, "utf8");
  const parsed = parseToml(source);

  return hostConfigSchema.parse(parsed);
};

