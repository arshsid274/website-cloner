import { cloneSite } from "@/lib/cloner";
import type { CloneProgress, CloneRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(req: Request) {
  let body: CloneRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const url = (body.url || "").trim();
  const routes =
    Array.isArray(body.routes) && body.routes.length > 0 ? body.routes : ["/"];
  if (!isHttpUrl(url)) {
    return new Response("Provide a valid http(s) URL", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (p: CloneProgress) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(p)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        await cloneSite({
          url,
          routes,
          settleMs: body.settleMs,
          emit: send,
          signal: req.signal,
        });
      } catch (err) {
        send({
          phase: "error",
          pagesDone: 0,
          pagesTotal: routes.length,
          filesSaved: 0,
          bytesSaved: 0,
          message: (err as Error).message,
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
