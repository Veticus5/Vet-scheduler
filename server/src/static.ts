import { assets, hasUI } from "./ui-assets.generated";

const DEV_PLACEHOLDER = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><title>Vet Scheduler</title></head>
<body style="font-family: system-ui; max-width: 40rem; margin: 4rem auto; line-height: 1.6">
<h1>Vet Scheduler — serwer działa ✅</h1>
<p>Interfejs nie został jeszcze zbudowany/osadzony w tym procesie.</p>
<ul>
  <li>Tryb deweloperski UI: uruchom <code>bun run dev:ui</code> (Vite na porcie 5173, proxy do API).</li>
  <li>Build produkcyjny: <code>bun run build:exe</code> osadzi UI w pliku .exe.</li>
</ul>
<p>API żyje pod <code>/api/health</code>.</p>
</body></html>`;

/** Serve the embedded SPA (production/compiled). Falls back to index.html for client routes. */
export function serveStatic(pathname: string): Response {
  if (!hasUI) {
    return new Response(DEV_PLACEHOLDER, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const key = pathname === "/" ? "/index.html" : pathname;
  const filePath = assets[key] ?? assets["/index.html"];
  if (!filePath) return new Response("Not found", { status: 404 });
  return new Response(Bun.file(filePath));
}
