import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Sealing what a business trusts Corva with: the connection to its database.
 *
 * AES-256-GCM under DATA_SOURCE_KEY. The key lives only in the environment, so
 * a copy of Corva's own database is not a copy of anyone's credentials.
 */

function key() {
  const raw = process.env.DATA_SOURCE_KEY;
  if (!raw || raw.length < 32) return null;
  // Any long secret works; hashing gives the 32 bytes the cipher wants.
  return createHash("sha256").update(raw).digest();
}

export const sealingReady = () => key() !== null;

export function seal(plain: string) {
  const k = key();
  if (!k) throw new Error("Connecting a database is not set up on this deployment yet (DATA_SOURCE_KEY).");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function unseal(sealed: string) {
  const k = key();
  if (!k) throw new Error("Connecting a database is not set up on this deployment yet (DATA_SOURCE_KEY).");
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("The saved connection could not be read. Connect the database again.");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("The saved connection could not be read. Connect the database again.");
  }
}
