import { randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Run a long async task while streaming periodic heartbeats, so the client
 * connection never goes idle. Bun closes idle sockets (idleTimeout), which the
 * browser surfaces as "Failed to fetch" — fatal for multi-minute AI generation.
 *
 * Emits NDJSON: `{"t":"ping"}` heartbeats, then a final `{"t":"result",...}`
 * or `{"t":"error",...}` line. The HTTP status is always 200 once streaming
 * starts, so errors are reported in-band rather than via status code.
 */
export function streamJob<T>(run: () => Promise<T>, heartbeatMs = 10_000): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* stream already closed */
        }
      };
      const beat = setInterval(() => send({ t: "ping" }), heartbeatMs);
      try {
        send({ t: "result", result: await run() });
      } catch (e) {
        const message =
          e instanceof HttpError ? e.message : e instanceof Error ? e.message : "Błąd serwera";
        if (!(e instanceof HttpError)) console.error("streamJob error:", e);
        send({ t: "error", error: message });
      } finally {
        clearInterval(beat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-cache" },
  });
}

/** Parse and minimally validate a JSON request body. */
export async function readJson<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Nieprawidłowy JSON w treści żądania");
  }
}
