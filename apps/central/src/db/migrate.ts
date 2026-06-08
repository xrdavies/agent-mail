import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";

import { createPostgresDatabase } from "./client.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const main = async () => {
  const { client, db } = createPostgresDatabase(databaseUrl);
  const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
