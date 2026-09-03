/**
 * Environment for CLI scripts (seed, embed, replay).
 *
 * `vercel env pull` writes .env.local, which Next.js loads automatically but
 * plain `tsx` does not — so scripts import this first.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });
