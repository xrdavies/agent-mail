import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { loadCentralConfig } from "../config.js";
import { CentralLogger } from "../lib/logger.js";
import { createDatabase, createPool } from "./client.js";

const config = loadCentralConfig();
const pool = createPool(config.databaseUrl);
const db = createDatabase(pool);
const logger = new CentralLogger(50);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(currentDir, "../../drizzle");

async function main(): Promise<void> {
  await migrate(db, { migrationsFolder });
  await pool.end();
}

main().catch(async (error) => {
  logger.logError({
    error,
    event: "migrate_error"
  });
  await pool.end();
  process.exitCode = 1;
});
