# Site Cloner v2 — Build Plan

A local app that **scans → clones (completely) → previews → harvests into Next.js+Tailwind components.**

v2 is a direct response to three failures found while testing v1 on a real Astro site (`toyokoh.com`):

| # | v1 failure (observed) | Root cause | v2 fix |
|---|---|---|---|
| 1 | Clone opened by double-click = broken CSS, dead animations | `file://` has no web root, blocks ES modules + `fetch()` | **Preview server** (§7) — the clone is *only* ever viewed over `http://localhost` |
| 2 | 161 of 256 assets missing (63%), mostly `@2x` images | `page.on('response')` only saves what the browser *chose* to fetch; skips srcset variants, breakpoint images, CSS backgrounds | **Exhaustive capture + verification loop** (§5) |
| 3 | Cloned HTML hard to turn into components (scoped hashes, styles in external CSS) | Framework cruft + styles not co-located with markup | **Section-harvest pipeline** with computed-style capture (§8) |

Everything in v1 that worked (scan, Playwright render, save-by-original-path, SSE progress) is retained. v2 *adds* stages; it doesn't replace the core.

---

## 0. Constraint (unchanged)

A browser tab can't write to disk or run Playwright. So this stays a **local Node app + browser UI over localhost**. Target: **Next.js App Router + TypeScript + Tailwind** (Option B = Electron later).

---

## 1. New high-level flow

```
paste URL → SCAN → CLONE (3-pass, complete) → VERIFY (0 missing) → PREVIEW (http server) → HARVEST (sections → components)
```

The two new terminal capabilities are **PREVIEW** (it actually runs) and **HARVEST** (it becomes a component library). VERIFY is a gate: the clone isn't "done" until referenced-assets == on-disk-assets.

---

## 2. Project structure (additions in **bold**)

```
site-cloner/
├─ src/
│  ├─ app/
│  │  ├─ page.tsx
│  │  └─ api/
│  │     ├─ scan/route.ts
│  │     ├─ clone/route.ts
│  │     ├─ preview/route.ts        ** start/stop static server for an output folder
│  │     ├─ verify/route.ts         ** referenced-vs-present asset audit
│  │     └─ harvest/route.ts        ** section extraction + computed styles
│  ├─ components/
│  │  ├─ UrlInput.tsx  ScanReport.tsx  RouteList.tsx  ProgressPanel.tsx
│  │  ├─ PreviewButton.tsx          ** "Open Preview" → opens localhost:PORT
│  │  ├─ AssetAudit.tsx             ** present / missing / backfilled counts
│  │  └─ SectionPicker.tsx          ** pick a section → export as component
│  ├─ lib/
│  │  ├─ scanner.ts  cloner.ts  paths.ts  types.ts
│  │  ├─ assets.ts                  ** exhaustive asset sweep + verify
│  │  ├─ preview.ts                 ** static http server (serve-handler)
│  │  └─ harvest.ts                 ** section detect + computed-style → Tailwind
```

---

## 3. Phase 1 — Scan (unchanged from v1)

Detect framework, discover routes, inventory assets, return `ScanReport`. One v2 addition to `notes`: estimate **srcset/responsive multiplier** so the size estimate isn't wildly low (v1 under-counted because it never saw the @2x files).

---

## 4. Phase 2 — Clone, pass A: reactive capture (from v1)

Same as v1: desktop UA, `page.on('response')` writes every same-site/CDN response to `<outDir>/<host>/<pathname>`, auto-scroll, settle delay, save post-JS `page.content()`, enqueue same-origin links. **This pass is necessary but not sufficient** — it gets JS/CSS/fonts and the 1x images, but misses the rest. Passes B and C fix that.

---

## 5. Phase 2.5 — Exhaustive capture + verification  ← THE "download every asset" feature

Three sub-passes turn "most assets" into "all assets":

### Pass B — Multi-viewport / multi-DPR render
The browser only fetches the srcset candidate matching the current device. So render each route more than once:

```ts
const PROFILES = [
  { width: 1440, height: 900, dpr: 1 },
  { width: 1440, height: 900, dpr: 2 },   // ← triggers @2x / retina srcset (recovered toyokoh's 86 missing files)
  { width: 768,  height: 1024, dpr: 2 },  // ← tablet breakpoint images
  { width: 390,  height: 844, dpr: 3 },   // ← mobile images + 3x
];
// for each profile: newContext({ viewport, deviceScaleFactor: dpr }) → goto → auto-scroll
```
`page.on('response')` (pass A's handler) stays attached, so anything newly fetched is saved automatically.

### Pass C — Static sweep (the guarantee)
Rendering can't be trusted to exercise every state, so finish with a **parse-and-fetch sweep** that does not depend on the browser:

```ts
// for every saved .html and .css file:
//   extract refs: src, href, poster, data-src, <link>, AND every srcset candidate, AND url() in CSS
//   EXPAND srcset:  "a.webp 1x, a@2x.webp 2x"  →  ["a.webp", "a@2x.webp"]   (drop 1x/2x/640w descriptors)
//   RESOLVE each ref against THAT file's original URL (new URL(ref, fileUrl)) — fixes ../../images/mv/bg.jpg
//   if same-origin (or allowed CDN) AND not already on disk → fetch() and write to its path
//   recurse: newly fetched CSS may reference more url() assets → sweep those too
```

Two rules that make it complete (both were the actual toyokoh failures):
1. **Expand srcset** — every candidate, not just the one the browser picked.
2. **Resolve relative to the referencing file** — `url(../../images/mv/bg.jpg)` inside `/_astro/x.css` must join against the CSS file's URL, not the page's.

### Verification gate
After B+C, run the audit and **loop until clean**:

```ts
interface AssetAudit {
  referenced: number;     // unique local asset URLs found across all html/css
  present: number;        // on disk
  missing: string[];      // referenced but absent  → target: []
  external: string[];     // off-origin CDN refs (report; download only if user opts in)
  backfilled: number;     // fetched by pass C
}
```
If `missing.length > 0`, fetch them and re-audit. Surface the final numbers in the UI (`AssetAudit.tsx`). A clone with `missing: []` is the definition of "done."

> **UI toggle the user asked for:** "Download every asset (exhaustive)" — ON by default. When OFF, run pass A only (fast, lossy). When ON, run A+B+C+verify. Also expose an "Include external CDN assets" checkbox (off by default — those 26 toyokoh CDN refs are usually third-party scripts/fonts).

---

## 6. Phase 3 — Path strategy (keep it working)

**Do NOT rewrite to relative paths by default.** We proved relative rewriting is a half-fix: it cures CSS 404s but ES modules + `fetch()` still die under `file://`. So:
- **Default:** leave absolute `/_astro/...` paths intact and serve via the preview server (§7). This is how the site is meant to run and needs zero mutation.
- **Optional "portable export" mode (stretch):** rewrite absolute→relative *and* warn that module-based sites still require a server. Only useful for old static sites.

---

## 7. Phase 4 — Preview server  ← fixes "it doesn't run on double-click"

The missing v1 step. After a clone, the app can serve its output folder over HTTP and open it.

```ts
// lib/preview.ts
import http from 'node:http';
import handler from 'serve-handler';     // npm i serve-handler
const servers = new Map<string, http.Server>();   // outDir → server

export function startPreview(outDir: string, port = 4321) {
  if (servers.has(outDir)) return `http://localhost:${port}`;
  const s = http.createServer((req, res) => handler(req, res, { public: outDir }));
  s.listen(port); servers.set(outDir, s);
  return `http://localhost:${port}`;
}
export function stopPreview(outDir: string) { servers.get(outDir)?.close(); servers.delete(outDir); }
```
- `public: outDir` makes the clone's folder the web **root**, so absolute `/_astro/...` paths resolve → 200. (Proven: every toyokoh asset that 404'd on `file://` returned 200 this way.)
- Use a **Node** static server (not Python) because it bundles into the app with no extra runtime dependency.
- UI: **"Open Preview"** button in the Done state → opens `http://localhost:PORT`. This replaces "double-click the folder," which never works for app-style sites.

---

## 8. Phase 5 — Harvest: clone → Next.js + Tailwind components  ← your end goal

The clone is reference material; this stage extracts reusable sections. Key insight learned from toyokoh: **the HTML alone is useless** because styles live in external scoped CSS (`svg-K0vp5Y`, `data-astro-cid-*`). You need HTML **+ resolved styles**. A real browser already resolved them — capture them with `getComputedStyle`.

Pipeline (`lib/harvest.ts`, run against the preview URL so styles are live):
1. **Segment** — find top-level section boundaries (`<section>`, `<header>`, `<footer>`, large direct children of `<main>`, ARIA landmarks). Present them in `SectionPicker.tsx` with thumbnails.
2. **Extract per section:**
   - the section's outerHTML (cleaned — strip `data-astro-*`, framework hooks, hashed classes)
   - a **computed-style map**: for each element, `getComputedStyle()` flattened to the properties that matter (layout, color, type, spacing, radius, shadow). This is framework-agnostic — works for Astro/Next/Vue/CSS-in-JS alike.
   - referenced assets for that section (so the component ships with its images)
3. **Convert to Tailwind** (two modes — pick per project):
   - **Reference-rebuild (recommended):** feed cleaned HTML + computed styles to Claude → idiomatic Tailwind component with tokens (`mt-9`, `gap-6`), props for text/images. Clean, reusable.
   - **Pixel-port:** map computed styles → exact Tailwind (arbitrary values `mt-[37px]`). Faithful but rigid.
4. **Emit** a `.tsx` component into your library (`components/harvested/<site>/<Section>.tsx`) + a manifest entry.
5. **Animations** are JS-driven (GSAP/lottie/canvas/scroll) — they do NOT survive extraction. Record an `animationNotes` field per section (what moved, on what trigger) and re-author with Framer Motion / GSAP in your stack as a second pass.

```ts
interface HarvestedSection {
  id: string; label: string;            // "hero", "features", "footer"
  html: string;                          // cleaned
  computed: Record<string, Record<string,string>>;  // selector → props
  assets: string[];
  animationNotes: string[];
  componentPath?: string;                // once converted
}
```

---

## 9. API contracts (additions)

- `POST /api/clone` — body gains `{ exhaustive: boolean, profiles?: Profile[], includeExternal?: boolean }`. SSE now also streams `phase: 'verify' | 'backfill'`.
- `POST /api/verify` → `AssetAudit`
- `POST /api/preview` → `{ url }` (start) / `DELETE` to stop
- `POST /api/harvest` → `{ sections: HarvestedSection[] }`; `POST /api/harvest/convert` `{ sectionId, mode }` → `{ componentPath }`

`CloneProgress` gains `phase: 'render-profile' | 'verify' | 'backfill'` and `missingRemaining: number`.

---

## 10. Milestones (v2 delta on top of v1)

- **v1 base (M1–M5):** scan + reactive clone + SSE + naming. *(as before)*
- **M6 — Preview server:** `preview.ts` + "Open Preview" button. *(½ day)* — biggest UX win, do first.
- **M7 — Exhaustive capture:** multi-profile renders + static sweep + verify loop + AssetAudit UI. *(1.5 days)* — the "download every asset" feature.
- **M8 — Harvest:** section segmentation + computed-style capture + SectionPicker. *(1.5 days)*
- **M9 — Convert:** Tailwind conversion (reference-rebuild via Claude). *(1–2 days)*
- **M10 (opt) — Electron wrap.** *(1 day)*

---

## 11. Limitations (honest, updated)

- **Runtime API data** still 404s offline — flag in scan notes (layout/styles fine, data-driven lists may be empty).
- **External CDN assets** off by default; some fonts/scripts live off-origin and won't be local unless opted in.
- **JS animations don't harvest** — they're re-authored, not copied. This is inherent, not a bug.
- **Exhaustive mode is slower** (N profiles × routes + sweep) and pulls more bytes — keep the toggle + a max-file-size filter.
- **Only clone sites you're permitted to.** This is for studying design/animation on sites you have rights to.

---

## 12. Scaffold (v2)

```bash
npx create-next-app@latest site-cloner --typescript --tailwind --app --src-dir
cd site-cloner
npm i playwright serve-handler
npx playwright install chromium
# build lib/cloner.ts (passes A+B) → lib/assets.ts (pass C + verify) → lib/preview.ts → lib/harvest.ts
npm run dev   # http://localhost:3000
```
