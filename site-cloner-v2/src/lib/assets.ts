import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { urlToPath } from "./paths";
import type { AssetAudit } from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_ASSET_BYTES = 25 * 1024 * 1024; // images, fonts, css, js, etc.
const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // video/audio get a much larger cap

const MEDIA_EXT_RE = /\.(mp4|webm|mov|m4v|ogv|ogg|mp3|wav|m4a|aac|m3u8|ts)(\?|$)/i;

// 3D / Three.js assets: models, geometry buffers, HDRI/env maps, GPU textures.
const MODEL_EXT_RE =
  /\.(glb|gltf|bin|hdr|exr|ktx2|basis|drc|ply|fbx|obj|mtl|usdz|usd|vrm|3ds|stl|dae)(\?|$)/i;

/** True for video/audio assets (which get the larger size cap). */
function isMediaUrl(u: URL | string): boolean {
  const s = typeof u === "string" ? u : u.pathname;
  return MEDIA_EXT_RE.test(s);
}

/** True for 3D model / Three.js assets (also get the larger size cap). */
function isModelUrl(u: URL | string): boolean {
  const s = typeof u === "string" ? u : u.pathname;
  return MODEL_EXT_RE.test(s);
}

// Match absolute/relative media OR model paths anywhere — even buried in a
// data-src JSON blob ({"mp4":"/assets/movies/pc/op.mp4"}) or a string literal
// inside a JS bundle (Three.js GLTFLoader.load("/models/scene.glb")), which
// neither the URL parser nor the browser's lazy loader reliably surfaces.
// Body char class excludes ? & = , ; so a match can't run across query-param
// or attribute-value boundaries (e.g. "poster.webp&...&envImage=https://x.hdr"
// must not be swallowed as one giant ref — the embedded https://x.hdr is found
// on its own instead).
const MEDIA_PATH_RE =
  /(?:https?:\/\/|\/|\.\.?\/)[^\s"'`()<>?&=,;]*?\.(?:mp4|webm|mov|m4v|ogv|ogg|mp3|wav|m4a|aac|m3u8|ts)\b/gi;
const MODEL_PATH_RE =
  /(?:https?:\/\/|\/|\.\.?\/)[^\s"'`()<>?&=,;]*?\.(?:glb|gltf|bin|hdr|exr|ktx2|basis|drc|ply|fbx|obj|mtl|usdz|usd|vrm|3ds|stl|dae)\b/gi;

/** Recursively list files under a dir matching one of the extensions. */
async function walk(dir: string, exts?: string[]): Promise<string[]> {
  const out: string[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(fp, exts)));
    } else if (!exts || exts.includes(path.extname(e.name).toLowerCase())) {
      out.push(fp);
    }
  }
  return out;
}

/**
 * Reconstruct the original URL a saved file came from. Layout is
 * `<outDir>/<host>/<pathname>`, so the first segment is the host.
 */
function fileToUrl(outDir: string, filePath: string): URL | null {
  const rel = path.relative(outDir, filePath);
  const parts = rel.split(path.sep);
  if (parts.length < 2) return null;
  const host = parts[0];
  if (!host.includes(".")) return null; // not a host folder (e.g. manifest.json)
  const pathname = "/" + parts.slice(1).join("/");
  try {
    return new URL(`https://${host}${pathname}`);
  } catch {
    return null;
  }
}

/** "a.webp 1x, a@2x.webp 2x" → ["a.webp", "a@2x.webp"] (drop descriptors). */
function expandSrcset(value: string): string[] {
  return value
    .split(",")
    .map((c) => c.trim().split(/\s+/)[0])
    .filter(Boolean);
}

const SKIP_REF = /^(data:|mailto:|tel:|javascript:|#|blob:|about:)/i;

type FileKind = "html" | "css" | "js" | "gltf";

function kindOf(file: string): FileKind {
  if (/\.css$/i.test(file)) return "css";
  if (/\.(m?js)$/i.test(file)) return "js";
  if (/\.gltf$/i.test(file)) return "gltf";
  return "html";
}

/** Pull asset references out of a document, scoped to its file kind. */
function extractRefs(content: string, kind: FileKind): string[] {
  const refs = new Set<string>();
  const add = (r: string) => {
    if (r && !SKIP_REF.test(r)) refs.add(r.trim());
  };

  // Video/audio + 3D-model paths can appear anywhere (data-src JSON, <source>,
  // CSS url(), or a string literal in a JS bundle), so always scan for them.
  for (const m of content.matchAll(MEDIA_PATH_RE)) add(m[0]);
  for (const m of content.matchAll(MODEL_PATH_RE)) add(m[0]);

  // JS bundles: ONLY the targeted binary paths above — generic string scraping
  // would pull thousands of false refs.
  if (kind === "js") return [...refs];

  // glTF JSON: follow its external buffers[].uri / images[].uri.
  if (kind === "gltf") {
    for (const m of content.matchAll(/"uri"\s*:\s*"([^"]+)"/gi)) add(m[1]);
    return [...refs];
  }

  if (kind === "css") {
    for (const m of content.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi))
      add(m[1]);
    for (const m of content.matchAll(/@import\s+['"]([^'"]+)['"]/gi)) add(m[1]);
    return [...refs];
  }

  // HTML: src / href / poster / data-src and friends.
  // NOTE: deliberately NOT `content=` — on <meta> tags that holds free text
  // (viewport "width=device-width", og:description, twitter:card), which would
  // resolve to bogus same-origin URLs and poison the audit with false misses.
  for (const m of content.matchAll(
    /\b(?:src|href|poster|data-src|data-lazy-src)\s*=\s*["']([^"']+)["']/gi,
  ))
    add(m[1]);
  // srcset / imagesrcset / data-srcset — expand every candidate
  for (const m of content.matchAll(
    /\b(?:srcset|imagesrcset|data-srcset)\s*=\s*["']([^"']+)["']/gi,
  ))
    for (const c of expandSrcset(m[1])) add(c);
  // inline style url()
  for (const m of content.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi))
    add(m[1]);
  return [...refs];
}

interface OriginRule {
  host: string; // primary host
  includeExternal: boolean;
  models?: boolean; // scan JS bundles + follow glTF for 3D/Three.js assets
}

function allowed(u: URL, rule: OriginRule): boolean {
  if (u.hostname === rule.host) return true;
  // www<->apex tolerance
  if (u.hostname.replace(/^www\./, "") === rule.host.replace(/^www\./, ""))
    return true;
  return rule.includeExternal;
}

const PAGE_EXTS = new Set(["", ".html", ".htm", ".php", ".aspx", ".jsp"]);

/**
 * True for things we should fetch/audit as assets. Excludes page routes
 * (`/about/`, `/`, `*.html`) so anchor hrefs don't show up as "missing".
 */
function looksLikeAsset(u: URL): boolean {
  const last = u.pathname.split("/").pop() || "";
  const dot = last.lastIndexOf(".");
  const ext = dot >= 0 ? last.slice(dot).toLowerCase() : "";
  return !PAGE_EXTS.has(ext);
}

/**
 * Pass C — the static sweep / guarantee. Parse every saved html+css, resolve
 * each reference against its OWN file URL, and fetch anything same-origin that
 * isn't already on disk. Recurses because freshly-fetched CSS adds new url()s.
 * Returns counts of newly written files and bytes.
 */
export async function staticSweep(
  outDir: string,
  rule: OriginRule,
  onProgress?: (msg: string, filesSaved: number, bytesSaved: number) => void,
): Promise<{ backfilled: number; bytes: number }> {
  let backfilled = 0;
  let bytes = 0;
  const processed = new Set<string>();

  // Seed the queue with on-disk html + css; add JS bundles when hunting for
  // 3D/Three.js assets that are referenced from string literals inside them.
  let queue = await walk(outDir, [".html", ".htm", ".css"]);
  if (rule.models) queue.push(...(await walk(outDir, [".js", ".mjs"])));

  while (queue.length) {
    const next: string[] = [];
    for (const file of queue) {
      if (processed.has(file)) continue;
      processed.add(file);

      const fileUrl = fileToUrl(outDir, file);
      if (!fileUrl) continue;

      let content: string;
      try {
        content = await fsp.readFile(file, "utf8");
      } catch {
        continue;
      }
      const refs = extractRefs(content, kindOf(file));

      for (const ref of refs) {
        let abs: URL;
        try {
          abs = new URL(ref, fileUrl);
        } catch {
          continue;
        }
        if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
        if (!allowed(abs, rule)) continue;
        if (!looksLikeAsset(abs)) continue; // skip page routes

        let dest: string;
        try {
          dest = urlToPath(outDir, abs.toString());
        } catch {
          continue;
        }
        if (fs.existsSync(dest)) continue;

        const ok = await fetchToDisk(abs, dest);
        if (ok) {
          backfilled++;
          bytes += ok;
          onProgress?.(abs.pathname, backfilled, bytes);
          // Freshly-fetched CSS or glTF references more assets — sweep them too
          // (glTF points at its .bin buffers and texture images).
          if (/\.(css|gltf)$/i.test(dest)) next.push(dest);
        }
      }
    }
    queue = next;
  }

  return { backfilled, bytes };
}

async function fetchToDisk(url: URL, dest: string): Promise<number | null> {
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    const isLarge =
      isMediaUrl(url) ||
      isModelUrl(url) ||
      /^(video|audio)\//i.test(ct) ||
      /\b(model|gltf|octet-stream)\b/i.test(ct);
    const cap = isLarge ? MAX_VIDEO_BYTES : MAX_ASSET_BYTES;
    const len = Number(res.headers.get("content-length") || 0);
    if (len > cap) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > cap) return null;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, buf);
    return buf.length;
  } catch {
    return null;
  }
}

/**
 * The verification gate. Walk every html+css, collect referenced same-origin
 * assets, and compare against what's on disk. `missing: []` == "done".
 */
export async function auditAssets(
  outDir: string,
  rule: OriginRule,
): Promise<AssetAudit> {
  // Audit reliable sources (html/css and glTF buffers/textures). JS bundles are
  // swept for models but NOT audited — speculative string matches there could
  // 404 and poison the "0 missing" gate.
  const exts = [".html", ".htm", ".css"];
  if (rule.models) exts.push(".gltf");
  const files = await walk(outDir, exts);
  const referenced = new Set<string>();
  const external = new Set<string>();

  for (const file of files) {
    const fileUrl = fileToUrl(outDir, file);
    if (!fileUrl) continue;
    let content: string;
    try {
      content = await fsp.readFile(file, "utf8");
    } catch {
      continue;
    }
    const refs = extractRefs(content, kindOf(file));
    for (const ref of refs) {
      let abs: URL;
      try {
        abs = new URL(ref, fileUrl);
      } catch {
        continue;
      }
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      if (!looksLikeAsset(abs)) continue; // ignore page-document refs (routes)
      if (allowed(abs, rule)) referenced.add(stripHash(abs));
      else external.add(stripHash(abs));
    }
  }

  const missing: string[] = [];
  let present = 0;
  for (const ref of referenced) {
    let dest: string;
    try {
      dest = urlToPath(outDir, ref);
    } catch {
      continue;
    }
    if (fs.existsSync(dest)) present++;
    else missing.push(ref);
  }

  return {
    referenced: referenced.size,
    present,
    missing,
    external: [...external],
    backfilled: 0,
  };
}

function stripHash(u: URL): string {
  return `${u.origin}${u.pathname}${u.search}`;
}

/** Run sweep then audit, looping until clean or no further progress. */
export async function exhaustiveVerify(
  outDir: string,
  rule: OriginRule,
  onProgress?: (msg: string, filesSaved: number, bytesSaved: number) => void,
  maxRounds = 3,
): Promise<AssetAudit> {
  let totalBackfilled = 0;
  let audit = await auditAssets(outDir, rule);

  for (let round = 0; round < maxRounds && audit.missing.length > 0; round++) {
    const swept = await staticSweep(outDir, rule, onProgress);
    totalBackfilled += swept.backfilled;
    const before = audit.missing.length;
    audit = await auditAssets(outDir, rule);
    if (audit.missing.length >= before && swept.backfilled === 0) break; // no progress
  }

  audit.backfilled = totalBackfilled;
  return audit;
}
