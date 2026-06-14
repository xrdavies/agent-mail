import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  host: z.string().min(1).default("0.0.0.0"),
  databaseUrl: z.string().min(1),
  bootstrapKeys: z.array(z.string().min(1)).min(1)
});

export type CentralConfig = z.infer<typeof configSchema>;

export function loadCentralConfig(env: NodeJS.ProcessEnv = process.env): CentralConfig {
  return configSchema.parse({
    port: env.CENTRAL_PORT,
    host: env.CENTRAL_HOST,
    databaseUrl:
      env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/agent_mail",
    bootstrapKeys:
      env.CENTRAL_BOOTSTRAP_KEYS?.split(",")
        .map((value) => value.trim())
        .filter(Boolean) ?? ["agent-mail-dev-bootstrap"]
  });
}
