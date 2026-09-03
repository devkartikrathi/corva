import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — run `vercel env pull`.");
}

/**
 * One HTTP-pooled client per process. Neon's serverless driver is the right
 * fit for Fluid Compute: no connection to hold open between requests.
 */
export const db = drizzle(neon(process.env.DATABASE_URL), { schema, casing: "snake_case" });

export { schema };
