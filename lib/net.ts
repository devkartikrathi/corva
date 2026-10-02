import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Calling addresses other people typed in.
 *
 * A business gives Corva a webhook URL, a website to read, a database host, a
 * mail server. Each is the server being asked to connect somewhere by someone
 * outside it, and "somewhere" must never be Corva's own network or its cloud
 * provider's metadata service. A host name is not enough to decide that — it
 * is whatever it resolves to — so the check is on the resolved addresses, and
 * a redirect is checked again.
 */

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || /^fe[89ab]/.test(v6);
}

export class UnreachableHostError extends Error {
  constructor(
    public reason: "not_found" | "private",
    public hostname: string,
  ) {
    super(reason === "private" ? "That address is not on the public internet." : `Could not find ${hostname}.`);
  }
}

/** The address a host name means, having checked every address it resolves to is public. */
export async function resolvePublic(hostname: string): Promise<string> {
  const host = hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    throw new UnreachableHostError("not_found", host);
  }
  if (addresses.length === 0) throw new UnreachableHostError("not_found", host);
  // Developing against something on this machine is allowed only when asked for by name.
  if (process.env.DATA_SOURCE_ALLOW_PRIVATE !== "1" && addresses.some(isPrivateAddress)) throw new UnreachableHostError("private", host);
  return addresses.find((a) => isIP(a) === 4) ?? addresses[0];
}

/**
 * fetch, for a URL someone outside gave us: http(s) only, public hosts only,
 * and each redirect is a new address to check rather than something to follow
 * blind.
 */
export async function fetchPublic(input: string | URL, init: RequestInit = {}, maxRedirects = 3): Promise<Response> {
  let url = new URL(input);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnreachableHostError("private", url.hostname);
    await resolvePublic(url.hostname);
    const res = await fetch(url, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    if (hop >= maxRedirects) throw new Error("Too many redirects.");
    url = new URL(location, url);
  }
}
