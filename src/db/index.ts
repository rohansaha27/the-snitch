import { Pool } from "@neondatabase/serverless";
import { config } from "../config";

export type DbStatus = "ok" | "skipped" | "error";

// null when DATABASE_URL is unset; callers must handle that.
export const db: Pool | null = config.databaseUrl
  ? new Pool({ connectionString: config.databaseUrl })
  : null;

db?.on("error", (err: Error) => console.error("[db] pool error:", err.message));

export let dbStatus: DbStatus = "skipped";

export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  if (!db) throw new Error("DATABASE_URL not set");
  const res = await db.query(text, params);
  return res.rows as T[];
}

// Runs schema.sql (idempotent). Never throws: the server still boots without a db.
export async function migrate(): Promise<DbStatus> {
  if (!db) {
    console.warn("[db] DATABASE_URL not set, skipping migrations");
    return (dbStatus = "skipped");
  }
  try {
    const schema = await Bun.file(new URL("./schema.sql", import.meta.url)).text();
    await db.query(schema);
    console.log("[db] migrated");
    return (dbStatus = "ok");
  } catch (err) {
    console.error("[db] migration failed:", (err as Error).message);
    return (dbStatus = "error");
  }
}
