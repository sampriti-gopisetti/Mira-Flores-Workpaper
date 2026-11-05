import "server-only";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

// DATABASE_URL (Neon in production) -> node-postgres pool.
// Otherwise an embedded Postgres (PGlite) persisted under .data/ for local dev.
// Both speak the same dialect, so every query below works on either.

export type DB = NodePgDatabase<typeof schema>;

const g = globalThis as unknown as { __db?: Promise<DB> };

async function create(): Promise<DB> {
  let db: DB;
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    db = drizzlePg(pool, { schema });
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { mkdirSync } = await import("node:fs");
    const dir = process.env.PGLITE_DIR ?? ".data/pglite";
    mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    db = drizzlePglite(client, { schema }) as unknown as DB;
  }
  for (const stmt of schema.DDL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.execute(sql.raw(stmt));
  }
  return db;
}

export function getDb(): Promise<DB> {
  if (!g.__db) g.__db = create().catch((e) => { g.__db = undefined; throw e; });
  return g.__db;
}
