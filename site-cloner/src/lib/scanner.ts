import { chromium } from "playwright";
import type { AssetKind, Framework, ScanReport } from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function classify(contentType: string, url: string): AssetKind {
  const ct = contentType.toLowerCase();
  const u = url.toLowerCase();
  if (ct.includes("javascript") || /\.m?js(\?|$)/.test(u)) return "js";
  if (ct.includes("css") || /\.css(\?|$)/.test(u)) return "css";
  if (ct.includes("font") || /\.(woff2?|ttf|otf|eot)(\?|$)/.test(u))
    return "font";
  if (ct.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|svg|ico)(\?|$)/.test(u))
    return "image";
  if (ct.startsWith("video/") || ct.startsWith("audio/") || /\.(mp4|webm|mp3|wav|ogg)(\?|$)/.test(u))
    return "media";
  return "other";
}

/** Cheap reconnaissance: framework, routes, asset inventory, est. size. */
export async function scanSite(rawUrl: string): Promise<ScanReport> {
  const url = new URL(rawUrl);
  const browser = await chromium.launch({ headless: true });
  const notes: string[] = [];
  const assetCounts: Record<AssetKind, number> = {
    js: 0,
    css: 0,
    font: 0,
    image: 0,
    media: 0,
    other: 0,
  };
  let estimatedBytes = 0;
  let xhrCount = 0;

  try {
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    page.on("response", (res) => {
      const req = res.request();
      const rt = req.resourceType();
      if (rt === "xhr" || rt === "fetch") xhrCount++;
      const ct = res.headers()["content-type"] || "";
      const kind = classify(ct, res.url());
      assetCounts[kind]++;
      const len = Number(res.headers()["content-length"] || 0);
      if (Number.isFinite(len)) estimatedBytes += len;
    });

    await page.goto(rawUrl, { waitUntil: "networkidle", timeout: 45000 });

    // --- Framework detection from runtime signals ---
    const framework = await page.evaluate((): Framework => {
      const w = window as unknown as Record<string, unknown>;
      if (w.__NEXT_DATA__) return "nextjs";
      if (w.__NUXT__ || document.getElementById("__nuxt")) return "nuxt";
      if (
        (w.__VUE__ as unknown) ||
        document.querySelector("[data-v-app]") ||
        document.querySelector("#app[data-server-rendered]")
      )
        return "vue";
      if (
        document.querySelector("[data-reactroot]") ||
        (w.__REACT_DEVTOOLS_GLOBAL_HOOK__ as unknown) ||
        document.getElementById("__next")
      )
        return "react";
      if (document.body && document.body.innerText.trim().length > 0)
        return "static";
      return "unknown";
    });

    // --- Route discovery ---
    const routes = new Set<string>(["/"]);

    // Primary: Next.js build manifest lists all routes.
    if (framework === "nextjs") {
      try {
        const buildId = await page.evaluate(() => {
          const d = (window as unknown as { __NEXT_DATA__?: { buildId?: string } })
            .__NEXT_DATA__;
          return d?.buildId ?? null;
        });
        if (buildId) {
          const manifestUrl = new URL(
            `/_next/static/${buildId}/_buildManifest.js`,
            url.origin,
          ).toString();
          const res = await page.context().request.get(manifestUrl);
          if (res.ok()) {
            const text = await res.text();
            // sortedPages:["/","/about",...] — pull quoted /paths
            const matches = text.match(/"\\u002F[^"]*"|"\/[^"]*"/g) || [];
            for (const m of matches) {
              const decoded = m
                .slice(1, -1)
                .replace(/\\u002F/g, "/");
              if (decoded.startsWith("/") && !decoded.includes("[")) {
                routes.add(decoded);
              }
            }
            notes.push("Routes discovered from Next.js _buildManifest.js");
          }
        }
      } catch {
        notes.push("Could not read Next.js build manifest; using link scan");
      }
    }

    // Fallback / supplement: same-origin anchor hrefs after render.
    const hrefs: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map(
        (a) => (a as HTMLAnchorElement).href,
      ),
    );
    for (const href of hrefs) {
      try {
        const h = new URL(href);
        if (h.origin === url.origin) {
          routes.add(h.pathname || "/");
        }
      } catch {
        /* ignore malformed */
      }
    }

    if (xhrCount > 0) {
      notes.push(
        `${xhrCount} runtime API call(s) detected — those may 404 offline ` +
          "and some data-driven sections can render empty.",
      );
    }

    await context.close();

    return {
      url: rawUrl,
      hostname: url.hostname,
      framework,
      routes: [...routes].sort(),
      assetCounts,
      estimatedBytes,
      notes,
    };
  } finally {
    await browser.close();
  }
}
