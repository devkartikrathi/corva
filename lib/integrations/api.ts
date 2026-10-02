import { brandForRequest } from "./keys";
import { allow } from "@/lib/rate-limit";

/**
 * The shared shape of Corva's public API: a key, a JSON body, JSON back.
 *
 * Errors are `{ error }` with a status that says whose fault it was — 401 for
 * a bad key, 400 for a bad request, 429 for too many — so a website can decide
 * whether to retry without reading the message.
 */

type Brand = NonNullable<Awaited<ReturnType<typeof brandForRequest>>>;

const MAX_BODY = 64 * 1024;
/** Requests a minute for one business, across all its keys and every server instance. */
const PER_MINUTE = 300;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function handle<T>(fn: (brand: Brand, body: T, req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    const brand = await brandForRequest(req);
    if (!brand) return Response.json({ error: "Missing or invalid API key." }, { status: 401 });
    if (!(await allow(`api:${brand.id}`, PER_MINUTE, 60))) {
      return Response.json({ error: "Too many requests. Slow down." }, { status: 429, headers: { "retry-after": "60" } });
    }

    const raw = req.method === "GET" ? "" : await req.text();
    if (raw.length > MAX_BODY) return Response.json({ error: "Request body too large." }, { status: 413 });
    let body: T;
    try {
      body = (raw ? JSON.parse(raw) : {}) as T;
    } catch {
      return Response.json({ error: "Body must be JSON." }, { status: 400 });
    }

    try {
      const result = await fn(brand, body, req);
      // A streamed reply is already a response.
      return result instanceof Response ? result : Response.json(result);
    } catch (e) {
      if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
      // Validation messages from the intake layer are meant to be read. They are
      // plain Errors with a short sentence; anything else — a database error, a
      // provider's, a TypeError — is ours, and its text stays in the log.
      const message = e instanceof Error ? e.message : "Something went wrong.";
      const expected = e instanceof Error && e.constructor === Error && message.length <= 200 && /required|valid|look right|too long|not/i.test(message);
      if (!expected) console.error("[api]", e);
      return Response.json({ error: expected ? message : "Something went wrong." }, { status: expected ? 400 : 500 });
    }
  };
}
