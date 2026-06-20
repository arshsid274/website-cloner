import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { ConvertMode, HarvestedSection } from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Segment a (preview) page into top-level sections and capture, per section:
 * cleaned outerHTML, a computed-style map (framework-agnostic — works for
 * Astro/Next/Vue alike because the browser already resolved the cascade),
 * referenced assets, and animation hints. Run against the PREVIEW url so
 * styles are live.
 */
export async function harvestSections(
  previewUrl: string,
): Promise<HarvestedSection[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();
    await page.goto(previewUrl, { waitUntil: "networkidle", timeout: 45000 });

    // CRITICAL: scroll the whole page first so entry/scroll-reveal animations
    // FIRE and lazy images LOAD. Pixel-port captures a static snapshot of
    // getComputedStyle, so if we captured before these ran, elements would be
    // frozen at their initial opacity:0 / translated-off state and the harvested
    // component would render blank. After scrolling we settle, then capture the
    // visible, final state.
    await autoScrollPage(page);
    await page.waitForTimeout(1600);

    const raw = await page.evaluate(extractSectionsInPage);

    // De-duplicate labels (hero, features, footer, section-2…)
    const seen = new Map<string, number>();
    const sections: HarvestedSection[] = raw.map((s, i) => {
      const base = s.label || `section-${i + 1}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const label = n === 1 ? base : `${base}-${n}`;
      return {
        id: `s${i + 1}`,
        label,
        html: cleanHtml(s.html),
        computed: s.computed,
        assets: s.assets,
        animationNotes: s.animationNotes,
        rect: s.rect,
      };
    });

    await ctx.close();
    return sections;
  } finally {
    await browser.close();
  }
}

/** Scroll top→bottom in steps (triggers reveals + lazy images), then back up. */
async function autoScrollPage(page: import("playwright").Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let total = 0;
      const step = Math.max(300, Math.floor(window.innerHeight * 0.85));
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 120);
    });
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Strip framework cruft from captured HTML; keep data-h (style keying). */
function cleanHtml(html: string): string {
  return (
    html
      // framework scoped markers
      .replace(/\s+data-astro-[a-z-]+(?:="[^"]*")?/gi, "")
      .replace(/\s+data-v-[0-9a-f]+(?:="[^"]*")?/gi, "")
      .replace(/\s+data-reactroot(?:="[^"]*")?/gi, "")
      // inline event handlers + scripts (don't survive extraction anyway)
      .replace(/\s+on[a-z]+="[^"]*"/gi, "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim()
  );
}

/**
 * Convert one harvested section into a component on disk.
 * - pixel-port (default, no API): faithful CSS-module component built from the
 *   computed styles. Always works offline.
 * - reference-rebuild: idiomatic Tailwind via Claude — needs ANTHROPIC_API_KEY.
 */
export async function convertSection(
  section: HarvestedSection,
  mode: ConvertMode,
  outBaseDir: string,
  siteSlug: string,
  cloneHostDir: string | null,
): Promise<{ componentPath: string }> {
  const compName = pascalCase(section.label);
  const dir = path.join(outBaseDir, siteSlug);
  const assetsDir = path.join(dir, "assets");
  await fsp.mkdir(assetsDir, { recursive: true });

  // `originalHtml` keeps the asset URLs as the clone serves them (e.g.
  // /_astro/x.webp) — used for the in-app preview, which resolves them against
  // the running clone server. `html` gets portable ./assets/ copies for export.
  const originalHtml = section.html;
  let html = section.html;
  if (cloneHostDir) {
    for (const ref of section.assets) {
      const copied = await copyAsset(ref, cloneHostDir, assetsDir);
      if (copied) {
        html = replaceAll(html, ref, `./assets/${copied}`);
        // also handle the bare pathname form
        try {
          const p = new URL(ref, "http://x").pathname;
          html = replaceAll(html, p, `./assets/${copied}`);
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (mode === "reference-rebuild") {
    const tsx = await rebuildWithClaude(section, compName, html);
    const componentPath = path.join(dir, `${compName}.tsx`);
    await fsp.writeFile(componentPath, tsx, "utf8");
    return { componentPath };
  }

  // pixel-port
  const css = computedToCss(section.computed);
  const cssPath = path.join(dir, `${compName}.module.css`);
  const componentPath = path.join(dir, `${compName}.tsx`);
  await fsp.writeFile(cssPath, css, "utf8");
  await fsp.writeFile(
    componentPath,
    pixelPortComponent(compName, html, section),
    "utf8",
  );
  // Preview HTML uses the ORIGINAL asset paths; the showcase points a <base>
  // at the running clone server so every image/font/video resolves live.
  await fsp.writeFile(
    path.join(dir, `${compName}.preview.html`),
    previewHtmlDoc(compName, originalHtml, css),
    "utf8",
  );
  return { componentPath };
}

/** A portable, self-contained HTML preview for a pixel-port section. */
function previewHtmlDoc(compName: string, html: string, css: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${compName} — preview</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
${css}
</style>
</head>
<body>
<div class="root">
${html}
</div>
</body>
</html>
`;
}

/**
 * Reconstruct a standalone preview from a pixel-port component's source + its
 * CSS module — used when no `.preview.html` exists on disk (e.g. components
 * exported before that file was generated). Returns null if the component
 * isn't a pixel-port one (no embedded `__html` / no css).
 */
export function synthesizePreview(
  code: string,
  css: string | undefined,
): string | null {
  if (!css) return null;
  const html = extractInnerHtml(code);
  if (html == null) return null;
  return previewHtmlDoc("Preview", html, css);
}

/** Pull the JSON string passed to `__html: "…"` out of the component source. */
function extractInnerHtml(code: string): string | null {
  const marker = "__html:";
  const i = code.indexOf(marker);
  if (i < 0) return null;
  const open = code.indexOf('"', i + marker.length);
  if (open < 0) return null;
  let k = open + 1;
  while (k < code.length) {
    if (code[k] === "\\") {
      k += 2;
      continue;
    }
    if (code[k] === '"') break;
    k++;
  }
  if (k >= code.length) return null;
  try {
    return JSON.parse(code.slice(open, k + 1)) as string;
  } catch {
    return null;
  }
}

/** Reference-rebuild via Claude. Requires ANTHROPIC_API_KEY in the env. */
async function rebuildWithClaude(
  section: HarvestedSection,
  compName: string,
  html: string,
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "reference-rebuild needs ANTHROPIC_API_KEY in the environment. " +
        "Use pixel-port mode for a no-API, deterministic component instead.",
    );
  }
  const computedSlim = JSON.stringify(section.computed).slice(0, 18000);
  const prompt = [
    "You are converting a captured website section into a single, idiomatic",
    "React + Tailwind CSS component. Use Tailwind utility classes (prefer",
    "tokens like mt-9, gap-6; arbitrary values only when necessary). Replace",
    "literal text with props where sensible. Return ONLY the .tsx file.",
    "",
    `Component name: ${compName}`,
    "Cleaned HTML:",
    html.slice(0, 16000),
    "",
    "Computed styles (selector -> props), use as ground truth for spacing,",
    "color, type, layout:",
    computedSlim,
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    content: { type: string; text?: string }[];
  };
  const text = data.content.map((c) => c.text ?? "").join("");
  // Strip ```tsx fences if present.
  return text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/i, "").trim() + "\n";
}

/** Build a faithful CSS-module component from computed styles. */
function pixelPortComponent(
  compName: string,
  html: string,
  section: HarvestedSection,
): string {
  const notes =
    section.animationNotes.length > 0
      ? `\n * Animation notes (re-author with Framer Motion / GSAP):\n` +
        section.animationNotes.map((n) => ` *  - ${n}`).join("\n")
      : "";
  return `import styles from "./${compName}.module.css";

/**
 * Harvested section "${section.label}" — pixel-port (computed styles).
 * Faithful layout/color/type captured from the live render. Hover/pseudo
 * states and JS animations are NOT captured.${notes}
 */
export default function ${compName}() {
  return (
    <div
      className={styles.root}
      dangerouslySetInnerHTML={{ __html: ${JSON.stringify(html)} }}
    />
  );
}
`;
}

/** computed map → scoped CSS module text. */
function computedToCss(
  computed: Record<string, Record<string, string>>,
): string {
  let out = `.root { all: initial; display: block; }\n`;
  out += `.root *, .root *::before, .root *::after { box-sizing: border-box; }\n`;
  for (const [key, props] of Object.entries(computed)) {
    const body = Object.entries(props)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n");
    if (body) out += `.root [data-h="${key}"] {\n${body}\n}\n`;
  }
  return out;
}

async function copyAsset(
  ref: string,
  cloneHostDir: string,
  assetsDir: string,
): Promise<string | null> {
  let pathname: string;
  try {
    pathname = new URL(ref, "http://x").pathname;
  } catch {
    return null;
  }
  const src = path.join(cloneHostDir, pathname);
  if (!fs.existsSync(src) || fs.statSync(src).isDirectory()) return null;
  const baseRaw = path.basename(pathname) || "asset";
  // Disambiguate identical basenames from different paths.
  const hash = Math.abs(hashCode(pathname)).toString(36).slice(0, 5);
  const base = `${hash}-${baseRaw}`;
  const dest = path.join(assetsDir, base);
  try {
    await fsp.copyFile(src, dest);
    return base;
  } catch {
    return null;
  }
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}

function replaceAll(s: string, find: string, rep: string): string {
  return s.split(find).join(rep);
}

function pascalCase(s: string): string {
  const p = s
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
  return /^[A-Za-z]/.test(p) ? p : `Section${p}`;
}

// ---------------------------------------------------------------------------
// Runs INSIDE the browser. Keep self-contained (no outer-scope refs).
// ---------------------------------------------------------------------------
function extractSectionsInPage() {
  const CURATED = [
    "display",
    "position",
    "flex-direction",
    "flex-wrap",
    "justify-content",
    "align-items",
    "gap",
    "grid-template-columns",
    "width",
    "height",
    "max-width",
    "min-height",
    "margin",
    "padding",
    "color",
    "background-color",
    "background-image",
    "background-size",
    "background-position",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-align",
    "text-transform",
    "border",
    "border-radius",
    "box-shadow",
    "opacity",
    "transform",
    "z-index",
    "object-fit",
    "overflow",
  ];
  // Generic no-op values that mean "browser default" for their property.
  const NOOP = new Set([
    "normal",
    "none",
    "auto",
    "static",
    "row",
    "nowrap",
    "visible",
    "0px",
    "rgba(0, 0, 0, 0)",
    "start",
    "0s",
    "fill", // default object-fit
  ]);

  function curated(el: Element): Record<string, string> {
    const cs = getComputedStyle(el);
    const out: Record<string, string> = {};
    for (const prop of CURATED) {
      const v = cs.getPropertyValue(prop).trim();
      if (!v || NOOP.has(v)) continue;
      if (prop === "opacity" && v === "1") continue;
      if (prop === "min-height" && v === "auto") continue;
      out[prop] = v;
    }
    return out;
  }

  function labelFor(el: Element, idx: number): string {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    if (tag === "header" || role === "banner") return "header";
    if (tag === "footer" || role === "contentinfo") return "footer";
    if (tag === "nav" || role === "navigation") return "nav";
    const id = el.getAttribute("id");
    if (id) return id;
    const heading = el.querySelector("h1, h2, h3");
    if (heading && heading.textContent) {
      const t = heading.textContent.replace(/\s+/g, " ").trim().slice(0, 40);
      if (t) return t;
    }
    if (idx === 0) return "hero";
    return `section-${idx + 1}`;
  }

  function animationHints(el: Element): string[] {
    const notes = new Set<string>();
    const all = [el, ...Array.from(el.querySelectorAll("*"))].slice(0, 600);
    for (const node of all) {
      const cls = node.getAttribute("class") || "";
      if (/\b(animate|aos|gsap|reveal|fade|slide|parallax|marquee)/i.test(cls)) {
        notes.add(`class "${cls.slice(0, 40)}" suggests an entry/scroll animation`);
      }
      const cs = getComputedStyle(node);
      if (cs.transitionDuration && cs.transitionDuration !== "0s") {
        notes.add(`CSS transition (${cs.transitionDuration}) on ${node.tagName.toLowerCase()}`);
      }
      if (node.tagName === "CANVAS") notes.add("contains <canvas> (JS-drawn graphics/animation)");
      if (node.tagName === "VIDEO") notes.add("contains <video>");
    }
    return [...notes].slice(0, 8);
  }

  // Pick top-level section candidates. Frameworks (Astro view-transitions,
  // Next, etc.) often wrap the whole page in a single router/layout <div>, so
  // descend through single-child wrappers, then expand any remaining oversized
  // wrapper (≈ taller than 1.6 viewports with ≥3 block children) into its
  // children — that's what turns one giant <div.inner> into real sections.
  const main = document.querySelector("main") || document.body;
  let root: Element = main;
  let guard = 0;
  while (root.children.length === 1 && guard < 6) {
    root = root.children[0];
    guard++;
  }

  const blockChildren = (el: Element): Element[] =>
    Array.from(el.children).filter((c) => {
      const r = c.getBoundingClientRect();
      return r.height > 40 && r.width > 100;
    });

  let list: Element[] = Array.from(root.children);
  for (let pass = 0; pass < 2; pass++) {
    const next: Element[] = [];
    for (const el of list) {
      const r = el.getBoundingClientRect();
      const kids = blockChildren(el);
      if (r.height > 1.6 * window.innerHeight && kids.length >= 3) {
        next.push(...kids);
      } else {
        next.push(el);
      }
    }
    list = next;
  }

  const candidates = new Set<Element>(list);
  document
    .querySelectorAll("body > header, body > footer, body > nav")
    .forEach((e) => candidates.add(e));

  const results: {
    label: string;
    html: string;
    computed: Record<string, Record<string, string>>;
    assets: string[];
    animationNotes: string[];
    rect: { width: number; height: number };
  }[] = [];

  let idx = 0;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.height < 60 || rect.width < 100) continue; // skip slivers

    // Tag the subtree with data-h and build the computed map.
    const computed: Record<string, Record<string, string>> = {};
    const nodes = [el, ...Array.from(el.querySelectorAll("*"))].slice(0, 400);
    nodes.forEach((node, i) => {
      node.setAttribute("data-h", String(i));
      const props = curated(node);
      if (Object.keys(props).length) computed[String(i)] = props;
    });

    // Collect referenced assets.
    const assets = new Set<string>();
    el.querySelectorAll("img[src]").forEach((n) => {
      const s = n.getAttribute("src");
      if (s) assets.add(s);
    });
    el.querySelectorAll("source[srcset], img[srcset]").forEach((n) => {
      const ss = n.getAttribute("srcset") || "";
      ss.split(",").forEach((c) => {
        const u = c.trim().split(/\s+/)[0];
        if (u) assets.add(u);
      });
    });
    nodes.forEach((node) => {
      const bg = getComputedStyle(node).backgroundImage;
      const m = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (m) assets.add(m[1]);
    });

    results.push({
      label: labelFor(el, idx),
      html: el.outerHTML,
      computed,
      assets: [...assets],
      animationNotes: animationHints(el),
      rect: { width: Math.round(rect.width), height: Math.round(rect.height) },
    });
    idx++;
  }
  return results;
}
