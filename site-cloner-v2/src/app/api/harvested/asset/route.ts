import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** Serve a file under <dir>/harvested/<rel> (for in-app component previews). */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const dir = sp.get("dir") || "";
  const rel = sp.get("rel") || "";
  if (!dir || !rel) return new Response("Bad request", { status: 400 });

  const root = path.resolve(path.join(dir, "harvested"));
  const fp = path.resolve(path.join(root, rel));
  if (fp !== root && !fp.startsWith(root + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    return new Response("Not found", { status: 404 });
  }
  const buf = await fsp.readFile(fp);
  return new Response(buf, {
    headers: {
      "Content-Type": TYPES[path.extname(fp).toLowerCase()] || "application/octet-stream",
    },
  });
}
