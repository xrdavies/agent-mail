import "dotenv/config";
import { serve } from "@hono/node-server";
import { z } from "zod";

import { createApp } from "./app.js";
import { createPostgresDatabase } from "./db/client.js";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000)
});

const env = envSchema.parse(process.env);
const { db } = createPostgresDatabase(env.DATABASE_URL);
const app = createApp(db as never);

serve(
  {
    fetch: app.fetch,
    port: env.PORT
  },
  (info) => {
    console.log(`Agent Mail Central listening on http://localhost:${info.port}`);
  }
);
