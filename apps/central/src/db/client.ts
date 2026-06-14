import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

export type CentralDatabase = NodePgDatabase<typeof schema>;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

export function createDatabase(pool: Pool): CentralDatabase {
  return drizzle(pool, { schema });
}
