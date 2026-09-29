import { openApiDocument } from "@/lib/integrations/openapi";
import { APP_URL } from "@/lib/email";

/** GET /api/v1/openapi.json — the API, for tools. Public: it describes, it does nothing. */
export function GET() {
  return Response.json(openApiDocument(APP_URL), { headers: { "cache-control": "public, max-age=300" } });
}
