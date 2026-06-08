import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export type CentralDb = ReturnType<typeof drizzle<typeof schema>>;

export const createPostgresDatabase = (databaseUrl: string) => {
  const client = postgres(databaseUrl, {
    max: 1
  });

  return {
    client,
    db: drizzle(client, { schema })
  };
};

