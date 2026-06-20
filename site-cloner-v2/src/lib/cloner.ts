import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Response } from "playwright";
import { downloadsTarget, urlToPath } from "./paths";
import { exhaustiveVerify } from "./assets";
import type { AssetAudit, CloneProgress, Profile } from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Size caps: general assets stay modest; video/audio get a much larger cap so
// hero loops and background videos are captured too.
const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300 MB (video/audio + 3D models)
const MEDIA_EXT_RE = /\.(mp4|webm|mov|m4v|ogv|ogg|mp3|wav|m4a|aac|m3u8|ts)(\?|$)/i;
const MODEL_EXT_RE =
  /\.(glb|gltf|bin|hdr|exr|ktx2|basis|drc|ply|fbx|obj|mtl|usdz|usd|vrm|3ds|stl|dae)(\?|$)/i;

/** Default multi-DPR / multi-viewport profiles for exhaustive capture. */
export const DEFAULT_PROFILES: Profile[] = [
  { width: 1440, height: 900, dpr: 1 },
  { width: 1440, height: 900, dpr: 2 }, // retina @2x srcset
  { width: 768, height: 1024, dpr: 2 }, // tablet breakpoint
  { width: 390, height: 844, dpr: 3 }, // mobile + @3x
];

export interface CloneOptions {
  url: string;
  routes: string[];
  settleMs?: number;
  /** v2: run passes B (multi-profile) + C (static sweep) + verify gate. */
  exhaustive?: boolean;
  profiles?: Profile[];
  /** v2: also fetch off-origin CDN assets during the sweep. */
  includeExternal?: boolean;
  /** v2: scan JS bundles + follow glTF for 3D / Three.js assets. */
  models?: boolean;
  /** Called after every meaningful event so the API can stream it. */
  emit: (p: CloneProgress) => void;
  /** Abort signal from the HTTP request being cancelled. */
  signal?: AbortSignal;
}

export interface CloneResult {
  outDir: string;
  pagesDone: number;
  filesSaved: number;
  bytesSaved: number;
  audit?: AssetAudit;
}

export async function cloneSite(opts: CloneOptions): Promise<CloneResult> {
  const { url, routes, emit, signal } = opts;
  const settleMs = opts.settleMs ?? 3500;
  const exhaustive = opts.exhaustive ?? true;
  const includeExternal = opts.includeExternal ?? false;
  const models = opts.models ?? true;
  const profiles = opts.profiles ?? DEFAULT_PROFILES;
  const origin = new URL(url);

  const outDir = downloadsTarget(origin.hostname, (p) => fs.existsSync(p));
  await fsp.mkdir(outDir, { recursive: true });

  let pagesDone = 0;
  let filesSaved = 0;
  let bytesSaved = 0;
  const savedPaths = new Set<string>();
  const captured: string[] = [];

  emit({
    phase: "starting",
    pagesDone: 0,
    pagesTotal: routes.length,
    filesSaved: 0,
    bytesSaved: 0,
    outDir,
    message: `Output: ${outDir}`,
  });

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1440, height: 900 },
    });

    const saveResponse = async (res: Response) => {
      try {
        const resUrl = res.url();
        if (!/^https?:/.test(resUrl)) return;
        // Only same-host or its asset CDNs that share the registrable domain.
        const ru = new URL(resUrl);
        const sameDomain =
          ru.hostname === origin.hostname ||
          ru.hostname.endsWith(rootDomain(origin.hostname));
        if (!sameDomain) return;

        const status = res.status();
        if (status >= 300 && status < 400) return; // redirects
        if (status >= 400) return;

        const ct = res.headers()["content-type"] || "";
        const isLarge =
          MEDIA_EXT_RE.test(ru.pathname) ||
          MODEL_EXT_RE.test(ru.pathname) ||
          /^(video|audio)\//i.test(ct) ||
          /\b(model|gltf|octet-stream)\b/i.test(ct);
        const cap = isLarge ? MAX_VIDEO_BYTES : MAX_ASSET_BYTES;
        const len = Number(res.headers()["content-length"] || 0);
        if (len > cap) {
          emit(progress(`skip (too large): ${ru.pathname}`));
          return;
        }

        let dest: string;
        try {
          dest = urlToPath(outDir, resUrl);
        } catch {
          return; // path-safety rejection
        }
        if (savedPaths.has(dest)) return;

        const body = await res.body().catch(() => null);
        if (!body) return;

        savedPaths.add(dest);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, body);
        filesSaved++;
        bytesSaved += body.length;
        emit({
          phase: "asset",
          currentUrl: resUrl,
          pagesDone,
          pagesTotal: routes.length,
          filesSaved,
          bytesSaved,
          message: ru.pathname,
        });
      } catch {
        /* best-effort: a failed asset shouldn't kill the clone */
      }
    };

    function progress(message: string): CloneProgress {
      return {
        phase: "asset",
        pagesDone,
        pagesTotal: routes.length,
        filesSaved,
        bytesSaved,
        message,
      };
    }

    context.on("response", saveResponse);

    const queue = [...new Set(routes.map(normalizeRoute))];
    const visited = new Set<string>();

    for (let i = 0; i < queue.length; i++) {
      if (signal?.aborted) throw new Error("aborted");
      const route = queue[i];
      if (visited.has(route)) continue;
      visited.add(route);

      const pageUrl = new URL(route, origin.origin).toString();
      emit({
        phase: "page",
        currentUrl: pageUrl,
        pagesDone,
        pagesTotal: queue.length,
        filesSaved,
        bytesSaved,
        message: `Rendering ${route}`,
      });

      const page = await context.newPage();
      try {
        const navResp = await page.goto(pageUrl, {
          waitUntil: "networkidle",
          timeout: 45000,
        });

        // CRITICAL for animations: capture the HTML in its *initial* state,
        // BEFORE auto-scrolling. Scroll-driven libraries (GSAP ScrollTrigger,
        // Framer Motion, IntersectionObserver reveals) write their END-state
        // transforms/opacity as inline styles once they fire — if we captured
        // after scrolling, the reopened page would show everything already
        // animated and never replay. We prefer the pristine server HTML (zero
        // client mutation) and fall back to the early rendered DOM for SPAs.
        const rawHtml = navResp ? await navResp.text().catch(() => null) : null;
        const renderedEarly = await page.content();
        // v2 §6: keep paths pristine (no relative rewrite) — the preview server
        // serves the host folder as web root, so absolute /_astro, /_next paths
        // resolve to 200 with zero mutation. This is how the site means to run.
        const html = pickHtml(rawHtml, renderedEarly);

        const htmlDest = urlToPath(outDir, pageUrl);
        await fsp.mkdir(path.dirname(htmlDest), { recursive: true });
        await fsp.writeFile(htmlDest, html, "utf8");
        if (!savedPaths.has(htmlDest)) {
          savedPaths.add(htmlDest);
          filesSaved++;
        }
        captured.push(route);

        // Now scroll — purely to trigger lazy-loaded assets so their network
        // responses get saved to disk. We've already kept the clean HTML.
        await autoScroll(page);
        await page.waitForTimeout(settleMs);

        // NOTE: we intentionally clone ONLY the user-approved routes (chosen in
        // the scan UI). Auto-enqueuing every discovered <a href> turns "clone
        // this page" into crawling the whole site. Route discovery belongs to
        // the scan phase, where the user can review and pick.

        pagesDone++;
        emit({
          phase: "page",
          currentUrl: pageUrl,
          pagesDone,
          pagesTotal: queue.length,
          filesSaved,
          bytesSaved,
          message: `Saved ${route}`,
        });
      } catch (err) {
        emit({
          phase: "error",
          currentUrl: pageUrl,
          pagesDone,
          pagesTotal: queue.length,
          filesSaved,
          bytesSaved,
          message: `Failed ${route}: ${(err as Error).message}`,
        });
      } finally {
        await page.close().catch(() => {});
      }
    }

    // ---- Pass B: multi-viewport / multi-DPR renders (exhaustive) ----
    // The browser only fetches the srcset candidate for the current device, so
    // re-render every captured route under retina/tablet/mobile profiles. The
    // shared `saveResponse` handler writes anything newly fetched to disk.
    if (exhaustive && captured.length > 0) {
      for (const profile of profiles) {
        const isBase =
          profile.width === 1440 && profile.height === 900 && profile.dpr === 1;
        if (isBase) continue; // pass A already covered this profile
        if (signal?.aborted) throw new Error("aborted");

        const pctx = await browser.newContext({
          userAgent: UA,
          viewport: { width: profile.width, height: profile.height },
          deviceScaleFactor: profile.dpr,
        });
        pctx.on("response", saveResponse);
        const tag = `${profile.width}×${profile.height} @${profile.dpr}x`;

        for (const route of captured) {
          if (signal?.aborted) throw new Error("aborted");
          const pageUrl = new URL(route, origin.origin).toString();
          emit({
            phase: "render-profile",
            currentUrl: pageUrl,
            pagesDone,
            pagesTotal: queue.length,
            filesSaved,
            bytesSaved,
            message: `${tag} · ${route}`,
          });
          const p = await pctx.newPage();
          try {
            await p.goto(pageUrl, { waitUntil: "networkidle", timeout: 45000 });
            await autoScroll(p);
            await p.waitForTimeout(Math.min(settleMs, 2000));
          } catch {
            /* best-effort */
          } finally {
            await p.close().catch(() => {});
          }
        }
        await pctx.close().catch(() => {});
      }
    }

    // Root index redirect if the entry route wasn't "/".
    const rootIndex = path.join(outDir, origin.hostname, "index.html");
    if (!fs.existsSync(rootIndex) && captured.length > 0) {
      const first = urlToPath(outDir, new URL(captured[0], origin.origin).toString());
      const rel = path.relative(path.dirname(rootIndex), first);
      await fsp.writeFile(
        rootIndex,
        `<!doctype html><meta http-equiv="refresh" content="0; url=${rel}">`,
        "utf8",
      );
    }

    // ---- Pass C + verification gate (exhaustive) ----
    // Parse every saved html/css, resolve each reference against its own file
    // URL (so url(../../img/x.png) in a nested CSS resolves correctly), and
    // fetch anything same-origin still missing. Loop until missing == [].
    let audit: AssetAudit | undefined;
    if (exhaustive) {
      emit({
        phase: "sweep",
        pagesDone,
        pagesTotal: queue.length,
        filesSaved,
        bytesSaved,
        message:
          "Static sweep — expanding srcset + CSS url() and backfilling…",
      });
      audit = await exhaustiveVerify(
        outDir,
        { host: origin.hostname, includeExternal, models },
        (msg, bf) => {
          emit({
            phase: "backfill",
            pagesDone,
            pagesTotal: queue.length,
            filesSaved: filesSaved + bf,
            bytesSaved,
            message: `backfill ${msg}`,
          });
        },
      );
      filesSaved += audit.backfilled;
      emit({
        phase: "verify",
        pagesDone,
        pagesTotal: queue.length,
        filesSaved,
        bytesSaved,
        missingRemaining: audit.missing.length,
        audit,
        message:
          `Verify — ${audit.present}/${audit.referenced} present, ` +
          `${audit.missing.length} missing, ${audit.backfilled} backfilled, ` +
          `${audit.external.length} external`,
      });
    }

    // Capture manifest (incl. final audit).
    await fsp.writeFile(
      path.join(outDir, "manifest.json"),
      JSON.stringify(
        {
          source: url,
          hostname: origin.hostname,
          capturedAt: new Date().toISOString(),
          routes: captured,
          filesSaved,
          bytesSaved,
          exhaustive,
          audit,
        },
        null,
        2,
      ),
      "utf8",
    );

    // Self-contained static server. JS-driven animations only run when the
    // site is served over HTTP (opening index.html via file:// blocks module
    // scripts / fetch of chunks). `node serve.mjs` previews it with animations.
    await fsp.writeFile(
      path.join(outDir, "serve.mjs"),
      serveScript(origin.hostname),
      "utf8",
    );

    emit({
      phase: "done",
      pagesDone,
      pagesTotal: queue.length,
      filesSaved,
      bytesSaved,
      outDir,
      audit,
      message:
        `Done — ${filesSaved} files, ${(bytesSaved / 1e6).toFixed(1)} MB` +
        (audit ? `, ${audit.missing.length} missing` : "") +
        `. Use Open Preview to view it running.`,
    });

    return { outDir, pagesDone, filesSaved, bytesSaved, audit };
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** Scroll top→bottom in steps to trigger lazy-load, then back to top. */
async function autoScroll(page: import("playwright").Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let total = 0;
      const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 150);
    });
  });
}

/**
 * Choose the HTML to persist. Prefer the pristine server response — it has the
 * real initial state so client JS can replay entry/scroll animations. Fall
 * back to the rendered DOM when the raw response is just an empty SPA shell.
 */
function pickHtml(rawHtml: string | null, rendered: string): string {
  if (
    rawHtml &&
    rawHtml.length > 1500 &&
    /<\/body\s*>/i.test(rawHtml) &&
    // an obvious empty shell renders far more than it shipped — prefer rendered
    !(rendered.length > rawHtml.length * 2.2)
  ) {
    return rawHtml;
  }
  return rendered;
}

/** A zero-dependency static file server, written into each clone's folder. */
function serveScript(hostname: string): string {
  return `// Auto-generated by Site Cloner. Run: node serve.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, ${JSON.stringify(hostname)});
const PORT = Number(process.env.PORT) || 4321;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

http
  .createServer((req, res) => {
    const reqPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let fp = path.join(ROOT, reqPath);
    // Block traversal outside ROOT.
    if (!path.resolve(fp).startsWith(path.resolve(ROOT))) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    try {
      if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
        fp = path.join(fp, "index.html");
      }
      if (!fs.existsSync(fp)) {
        // Extension-less route saved as <route>/index.html
        const alt = path.join(ROOT, reqPath, "index.html");
        fp = fs.existsSync(alt) ? alt : path.join(ROOT, "index.html");
      }
      const buf = fs.readFileSync(fp);
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(fp)] || "application/octet-stream",
      });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(PORT, () => {
    console.log("Serving " + ROOT);
    console.log("→ http://localhost:" + PORT);
  });
`;
}

function normalizeRoute(p: string): string {
  if (!p.startsWith("/")) p = "/" + p;
  // strip trailing slash except for root
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/** Crude registrable-domain helper: last two labels (e.g. example.com). */
function rootDomain(hostname: string): string {
  const parts = hostname.split(".");
  return parts.length <= 2 ? hostname : "." + parts.slice(-2).join(".");
}
