import { generateText } from "ai";
import { DEFAULT_MODEL_ID, resolveModel } from "@/lib/agent/models";
import { languageModel, thinkingOptions } from "@/lib/agent/model";
import { recordModelCall } from "@/lib/agent/quota";

/**
 * Reading a business's website into something the agent can answer from.
 *
 * The owner already wrote down their prices, hours and policies once — on
 * their site. Asking them to type it all again into a form is where onboarding
 * stalls, so onboarding reads the site instead: the home page and the few
 * pages most likely to hold answers (about, services, pricing, FAQ, contact).
 *
 * The raw text of a web page is mostly navigation and cookie banners, so a
 * model rewrites it into short "Topic: fact" paragraphs — which is also the
 * shape `chunk()` turns into citable anchors. If that call fails, the cleaned
 * text is used as it is: less tidy, still true.
 */

const MAX_PAGES = 5;
const MAX_CHARS_PER_PAGE = 12_000;
const MAX_TOTAL_CHARS = 40_000;
const FETCH_TIMEOUT_MS = 10_000;

/** Pages worth following from the home page, by what their link says. */
const USEFUL = /(about|service|product|pricing|price|fees?|faq|help|support|contact|location|hours|menu|course|treatment|doctor|project|plans?|shipping|return|refund|policy)/i;

export type WebsiteRead = {
  url: string;
  pages: string[];
  /** The knowledge document body, "Topic: text" paragraphs. */
  body: string;
  rewritten: boolean;
};

export function normaliseUrl(input: string): URL {
  const raw = input.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http and https websites can be read.");
  // A staff member typing a URL is not an attacker, but the server fetching
  // whatever it is given is how internal services get probed.
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "[::1]"
  ) {
    throw new Error("That address is not a public website.");
  }
  return url;
}

async function fetchPage(url: URL): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; CorvaOnboarding/1.0; +https://corva.systems)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&rdquo;": "”",
  "&ldquo;": "“",
  "&ndash;": "–",
  "&mdash;": "—",
  "&#8377;": "₹",
  "&hellip;": "…",
};

/** Page text, one block per line, without the chrome around it. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[#a-z0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? (e.startsWith("&#") ? String.fromCharCode(Number(e.slice(2, -1)) || 32) : " "))
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    // Menu fragments and buttons: too short to be an answer to anything.
    .filter((line) => line.length > 25 || /\d/.test(line))
    .join("\n");
}

function titleOf(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(`<p>${m[1]}</p>`).trim() || null : null;
}

function usefulLinks(html: string, base: URL): URL[] {
  const found = new Map<string, URL>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href, label] = m;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.hostname !== base.hostname) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|zip|docx?)$/i.test(url.pathname)) continue;
    url.hash = "";
    if (url.href === base.href) continue;
    if (!USEFUL.test(url.pathname) && !USEFUL.test(label)) continue;
    found.set(url.href, url);
  }
  return [...found.values()].slice(0, MAX_PAGES - 1);
}

/** Read the site. Throws only when even the home page cannot be read. */
export async function readWebsite(input: string, businessName: string): Promise<WebsiteRead> {
  const home = normaliseUrl(input);
  const homeHtml = await fetchPage(home);
  if (!homeHtml) throw new Error(`Could not read ${home.hostname} — check the address is right and public.`);

  const pages: { url: string; title: string | null; text: string }[] = [
    { url: home.href, title: titleOf(homeHtml), text: htmlToText(homeHtml).slice(0, MAX_CHARS_PER_PAGE) },
  ];
  const others = await Promise.all(
    usefulLinks(homeHtml, home).map(async (url) => {
      const html = await fetchPage(url);
      return html ? { url: url.href, title: titleOf(html), text: htmlToText(html).slice(0, MAX_CHARS_PER_PAGE) } : null;
    }),
  );
  for (const p of others) if (p && p.text.length > 80) pages.push(p);

  let raw = "";
  for (const p of pages) {
    const block = `## ${p.title ?? p.url}\n${p.text}\n\n`;
    if (raw.length + block.length > MAX_TOTAL_CHARS) break;
    raw += block;
  }

  const rewritten = await rewrite(raw, businessName);
  return {
    url: home.href,
    pages: pages.map((p) => p.url),
    body: rewritten ?? fallbackBody(raw),
    rewritten: rewritten !== null,
  };
}

/** Plain paragraphs from the raw text, when the model is not available. */
function fallbackBody(raw: string): string {
  return raw
    .split("\n")
    .filter((l) => !l.startsWith("## ") && l.length > 40)
    .slice(0, 80)
    .join("\n\n");
}

/**
 * Ask the model to turn page text into knowledge.
 *
 * Instructed to keep only what the pages actually say — the agent will treat
 * every sentence of this as something it is allowed to tell a caller, so an
 * invented opening hour here becomes a promise the business did not make.
 */
export async function rewrite(raw: string, businessName: string): Promise<string | null> {
  if (!raw.trim()) return null;
  const model = resolveModel(DEFAULT_MODEL_ID);
  try {
    const { text, usage } = await generateText({
      model: languageModel(model.id),
      providerOptions: thinkingOptions("low"),
      system: `You turn website text into a knowledge base for ${businessName}'s phone assistant.
Write short paragraphs separated by blank lines. Start each paragraph with a short topic and a colon,
for example "Opening hours: ...", "Delivery: ...", "Consultation fee: ...".
Keep every concrete fact: services, products, prices in rupees, hours, locations, phone numbers,
policies, eligibility, how to book. Drop navigation, marketing slogans, cookie notices and anything
repeated. Never add a fact that is not in the text. If the text contains nothing useful, reply NONE.`,
      prompt: raw,
    });
    await recordModelCall(model.id, usage);
    const body = text.trim();
    return body && body !== "NONE" ? body : null;
  } catch (e) {
    console.error("website rewrite failed:", (e as Error).message);
    return null;
  }
}
