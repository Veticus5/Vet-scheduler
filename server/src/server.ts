import { handleApi } from "./api/index";
import { serveStatic } from "./static";

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function createServer(port: number) {
  return Bun.serve({
    port,
    idleTimeout: 120, // generation can take a while
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      const apiResponse = await handleApi(req);
      if (apiResponse) {
        for (const [k, v] of Object.entries(CORS_HEADERS)) apiResponse.headers.set(k, v);
        return apiResponse;
      }

      return serveStatic(url.pathname);
    },
  });
}
