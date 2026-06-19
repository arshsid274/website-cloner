import os from "node:os";
import path from "node:path";

/** The OS Downloads directory, overridable via CLONE_OUT_DIR for edge cases. */
export function downloadsDir(): string {
  return process.env.CLONE_OUT_DIR || path.join(os.homedir(), "Downloads");
}

/** `https://www.donmolinico.es/` → `donmolinico-es` */
export function slugifyHost(hostname: string): string {
  return hostname
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** A filesystem timestamp like `2026-06-18-1432` (local time). */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}`
  );
}

/**
 * Resolve the output folder for a host inside Downloads, appending a
 * timestamp if the base folder already exists (collision handling).
 * Uses a sync existence check supplied by the caller to stay pure-ish.
 */
export function downloadsTarget(
  hostname: string,
  exists: (p: string) => boolean,
): string {
  const base = path.join(downloadsDir(), slugifyHost(hostname));
  if (!exists(base)) return base;
  return `${base}-${stamp()}`;
}

/**
 * Map a remote URL to a safe on-disk path under outDir.
 * Strips query strings, sanitises segments, blocks `..` traversal, and
 * gives directory-style URLs an `index.html`.
 */
export function urlToPath(outDir: string, rawUrl: string): string {
  const u = new URL(rawUrl);
  const host = u.hostname;

  let pathname = decodeURIComponent(u.pathname);
  // Directory or root → index.html
  if (pathname.endsWith("/") || pathname === "") {
    pathname += "index.html";
  } else if (!path.extname(pathname)) {
    // Extension-less route (e.g. /about) → treat as an HTML page folder
    pathname += "/index.html";
  }

  const segments = pathname
    .split("/")
    .filter((s) => s && s !== "." && s !== "..")
    .map(sanitizeSegment);

  const resolved = path.join(outDir, host, ...segments);

  // Final guard: ensure we never escape outDir.
  const root = path.resolve(outDir);
  if (!path.resolve(resolved).startsWith(root + path.sep)) {
    throw new Error(`Refusing to write outside output dir: ${rawUrl}`);
  }
  return resolved;
}

function sanitizeSegment(seg: string): string {
  // Remove characters illegal on common filesystems; cap length.
  const cleaned = seg.replace(/[<>:"\\|?*\x00-\x1f]/g, "_").slice(0, 180);
  return cleaned || "_";
}
