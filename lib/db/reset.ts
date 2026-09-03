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
  console.log("Schema reset.");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
