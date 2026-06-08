import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to generate migrations.");
}

export default defineConfig({
  schema: "./apps/central/src/db/schema.ts",
  out: "./apps/central/drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL
  }
});

