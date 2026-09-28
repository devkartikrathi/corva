/** Drops and recreates the public schema. Development only. */
import "./script-env";
import { sql } from "drizzle-orm";
import { db } from "./index";

async function main() {
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to reset a production database.");
  }
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  /**
   * Drizzle's ledger lives in its own schema, not in `public`.
   *
   * Dropping `public` alone leaves `drizzle.__drizzle_migrations` behind with
   * every migration still marked applied — so the next `db:migrate` reports
   * success, creates nothing, and `db:seed` fails on a table that does not
   * exist. Resetting means resetting the record of what has been run too.
   */
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  console.log("Schema reset — including the migration ledger.");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
