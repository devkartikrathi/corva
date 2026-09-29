import { brandForRequest } from "./keys";

/**
 * The shared shape of Corva's public API: a key, a JSON body, JSON back.
 *
 * Errors are `{ error }` with a status that says whose fault it was — 401 for
 * a bad key, 400 for a bad request, 429 for too many — so a website can decide
 * whether to retry without reading the message.
 */

type Brand = NonNullable<Awaited<ReturnType<typeof brandForRequest>>>;

const MAX_BODY = 64 * 1024;
const WINDOW_MS = 60_000;
const PER_MINUTE = 120;
const hits = new Map<string, number[]>();

/** Best-effort, per process: enough to stop a runaway loop, not an abuser. */
function limited(brandId: string) {
  const now = Date.now();
  const recent = (hits.get(brandId) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(brandId, recent);
  return recent.length > PER_MINUTE;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function handle<T>(fn: (brand: Brand, body: T) => Promise<unknown>) {
  return async (req: Request) => {
    const brand = await brandForRequest(req);
    if (!brand) return Response.json({ error: "Missing or invalid API key." }, { status: 401 });
    if (limited(brand.id)) return Response.json({ error: "Too many requests. Slow down." }, { status: 429 });

    const raw = await req.text();
    if (raw.length > MAX_BODY) return Response.json({ error: "Request body too large." }, { status: 413 });
    let body: T;
    try {
      body = (raw ? JSON.parse(raw) : {}) as T;
    } catch {
      return Response.json({ error: "Body must be JSON." }, { status: 400 });
    }

    try {
      return Response.json(await fn(brand, body));
    } catch (e) {
      if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
      // Validation messages from the intake layer are meant to be read.
      const message = e instanceof Error ? e.message : "Something went wrong.";
      const expected = /required|valid|look right|too long|not/i.test(message);
      if (!expected) console.error("[api]", e);
      return Response.json({ error: expected ? message : "Something went wrong." }, { status: expected ? 400 : 500 });
    }
  };
}
