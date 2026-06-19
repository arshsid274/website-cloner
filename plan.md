# Site Cloner Web App — Build Plan

A local web app where you paste a URL, it **scans** the domain (detects framework, discovers routes, inventories assets), then **clones** the site with a real headless browser and saves it to `~/Downloads/<website-name>/`.

---

## 0. The one constraint that shapes everything

A page running in a normal browser tab **cannot write to your `Downloads` folder** or run Playwright — the browser sandbox forbids both. So this is **not** a pure front-end app. It must be a **local app**: a small Node server (which runs Playwright and writes files) plus a browser UI that talks to it over `localhost`.

Two viable shapes:

| Option | What it is | Best when |
|---|---|---|
| **A — Next.js local app** (recommended) | One Next.js project. UI = React pages. Backend = Route Handlers that run Playwright server-side. You run `npm run dev` and open `localhost:3000`. | You want to stay in your existing stack and keep it simple. |
| **B — Electron app** | Desktop app, no terminal needed, double-click to launch. Same Playwright backend inside the Electron main process. | You want a "real app" you can hand to non-developers. |

This plan targets **Option A** (Next.js App Router, React 19, TypeScript, Tailwind) and notes where B differs.

---

## 1. High-level flow

```
┌─────────────┐   paste URL    ┌──────────────┐   scan job    ┌─────────────┐
│   Browser   │ ─────────────▶ │  Next.js API │ ───────────▶  │  Playwright │
│   UI (React)│                │  (localhost) │               │  (headless) │
│             │ ◀───────────── │              │ ◀───────────  │             │
└─────────────┘  scan report   └──────────────┘  results      └─────────────┘
       │                              │
       │   "Clone it" click           │  clone job (SSE progress)
       └──────────────────────────────┴──────────▶ writes to ~/Downloads/<site>/
```

1. User pastes `https://www.example.com/`.
2. **Scan phase** — quick render to detect: framework (Next/React/Vue/static), route list, asset count, estimated size. Returns a report to the UI.
3. User reviews the report, optionally edits the route list, clicks **Clone**.
4. **Clone phase** — full capture, streaming live progress (pages done, files saved) back to the UI.
5. Files land in `~/Downloads/<slugified-hostname>/`. UI shows the final path + a "Reveal in folder" button.

---

## 2. Tech stack

- **Framework:** Next.js (App Router) + TypeScript
- **UI:** React 19 + Tailwind CSS. (GSAP/Framer Motion optional for polish — you already use these.)
- **Browser automation:** `playwright` (Chromium)
- **Progress streaming:** Server-Sent Events (simplest) or WebSocket
- **Filesystem:** Node `fs/promises`, resolve Downloads via `os.homedir()`
- **Slug/util:** small helper, no heavy deps
- **State (optional):** Zustand or React state — jobs are short-lived, so plain state is fine

---

## 3. Project structure

```
site-cloner/
├─ package.json
├─ next.config.ts
├─ tsconfig.json
├─ tailwind.config.ts
├─ src/
│  ├─ app/
│  │  ├─ page.tsx                 # main UI (paste box, report, progress)
│  │  ├─ layout.tsx
│  │  └─ api/
│  │     ├─ scan/route.ts         # POST → returns ScanReport
│  │     └─ clone/route.ts        # POST → SSE stream of CloneProgress
│  ├─ components/
│  │  ├─ UrlInput.tsx
│  │  ├─ ScanReport.tsx           # framework, routes (editable), asset stats
│  │  ├─ RouteList.tsx            # checkboxes to include/exclude routes
│  │  └─ ProgressPanel.tsx        # live log + progress bar
│  ├─ lib/
│  │  ├─ scanner.ts               # Playwright scan logic
│  │  ├─ cloner.ts                # Playwright capture logic (core)
│  │  ├─ paths.ts                 # urlToPath, slugifyHost, downloadsDir
│  │  └─ types.ts                 # ScanReport, CloneProgress, etc.
│  └─ styles/globals.css
└─ README.md
```

**Electron note (Option B):** move `lib/scanner.ts` + `lib/cloner.ts` into the Electron **main** process and expose them over IPC; keep the React UI in the renderer.

---

## 4. Phase 1 — Domain scan (`lib/scanner.ts`)

Goal: cheap reconnaissance so the user knows what they're about to download.

Steps:
1. Launch Chromium headless, `goto(url, { waitUntil: 'networkidle' })`.
2. **Detect framework** from runtime signals:
   - `window.__NEXT_DATA__` present → **Next.js**
   - `#__nuxt` / `window.__NUXT__` → **Nuxt**
   - `[data-reactroot]` or React devtools hook → **React (generic)**
   - none of the above + meaningful server HTML → **static / SSR**
3. **Discover routes:**
   - Primary: fetch `/_next/static/<buildId>/_buildManifest.js` (Next sites list routes here).
   - Fallback: collect `a[href]` after render + same-origin links found while scrolling.
   - Let the user add/remove routes manually before cloning.
4. **Inventory assets:** count responses by type (js / css / font / image / media) and sum `content-length` → estimated download size.
5. Return a `ScanReport`:

```ts
interface ScanReport {
  url: string;
  hostname: string;
  framework: 'nextjs' | 'nuxt' | 'react' | 'static' | 'unknown';
  routes: string[];
  assetCounts: Record<'js'|'css'|'font'|'image'|'media'|'other', number>;
  estimatedBytes: number;
  notes: string[];        // e.g. "runtime API calls detected — may 404 offline"
}
```

---

## 5. Phase 2 — Clone (`lib/cloner.ts`)  ← the core

This is the **correct Playwright way** for JS-rendered sites: render with a real browser and **save every network response** at its original path, so the `_next/static` JS chunks that drive animations are present offline.

Algorithm:
1. Create a browser context with a desktop UA + `1440×900` viewport.
2. Attach a `page.on('response')` handler that writes **every** same-site / CDN asset to disk under `<outDir>/<host>/<pathname>`.
3. For each route in the (user-approved) queue:
   - `goto(route, { waitUntil: 'networkidle' })`
   - **Auto-scroll** top→bottom in steps to trigger lazy-load + scroll-driven animations, then scroll back up.
   - Wait a settle delay (≈3–4 s) for late chunks.
   - Save the **post-JS rendered HTML** (`page.content()`), not the "Loading…" shell.
   - Extract `a[href]`, enqueue new same-origin routes.
4. Emit a `CloneProgress` event after each page/asset so the UI can stream it.
5. On finish, write a tiny `index.html` redirect at the folder root if the entry route wasn't `/`, and a `manifest.json` (what was captured).

```ts
interface CloneProgress {
  phase: 'starting' | 'page' | 'asset' | 'done' | 'error';
  currentUrl?: string;
  pagesDone: number;
  filesSaved: number;
  bytesSaved: number;
  message?: string;
}
```

> The single-page capture script we already built is the seed for this file — promote its `response` handler, `urlToPath`, and scroll logic into `cloner.ts`, and replace `console.log` with `emit(progress)`.

---

## 6. Save location & folder naming (`lib/paths.ts`)

- **Downloads dir:** `path.join(os.homedir(), 'Downloads')`. (Cross-platform; on most OSes this is correct. Allow an env override `CLONE_OUT_DIR` for edge cases.)
- **Folder name:** slugified hostname, `www.` stripped:
  - `https://www.donmolinico.es/` → `donmolinico-es`
  - `https://shop.example.co.uk/` → `shop-example-co-uk`
- **Collision handling:** if `donmolinico-es` exists, append a timestamp → `donmolinico-es-2026-06-18-1432`.
- **Path safety:** sanitise each URL pathname (strip `..`, illegal chars) before writing — never let a remote URL escape the target folder.

```ts
function slugifyHost(hostname: string): string {
  return hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}
function downloadsTarget(hostname: string): string {
  return path.join(os.homedir(), 'Downloads', slugifyHost(hostname));
}
```

---

## 7. API contracts

**`POST /api/scan`**
```json
// request
{ "url": "https://www.donmolinico.es/" }
// response → ScanReport (see §4)
```

**`POST /api/clone`** → responds with an **SSE stream** of `CloneProgress` JSON lines.
```json
// request
{ "url": "https://www.donmolinico.es/", "routes": ["/", "/about"], "settleMs": 3500 }
// stream: data: {"phase":"page","currentUrl":"/","pagesDone":1,...}\n\n
```

Keep both handlers on the Node runtime (`export const runtime = 'nodejs'`) — Playwright won't run on the Edge runtime.

---

## 8. UI behaviour (`app/page.tsx` + components)

1. **UrlInput** — paste box + "Scan" button; validates it's a real `http(s)` URL.
2. **ScanReport** — shows framework badge, estimated size, asset breakdown, and an **editable route list** (checkboxes; add-route input).
3. **Clone button** — disabled until a scan succeeds; sends approved routes.
4. **ProgressPanel** — progress bar (pagesDone / total) + a live scrolling log fed by the SSE stream.
5. **Done state** — show final folder path, a **Copy path** button, and (Electron only) a **Reveal in Finder/Explorer** button via `shell.showItemInFolder`.

---

## 9. Build milestones

- **M1 — Skeleton:** Next.js app boots, paste box renders, `/api/scan` returns a hardcoded report. *(½ day)*
- **M2 — Real scan:** wire Playwright into `scanner.ts`; framework + route detection working. *(1 day)*
- **M3 — Real clone:** port the existing capture script into `cloner.ts`; saves to `Downloads/<slug>/`. *(1 day)*
- **M4 — Live progress:** SSE stream + ProgressPanel. *(½ day)*
- **M5 — Polish:** route editing, collision handling, error states, README. *(½ day)*
- **M6 (optional) — Electron wrap:** package as a double-click app. *(1 day)*

---

## 10. Edge cases & limitations (be honest with yourself here)

- **Runtime API data:** sites that fetch from their own API at runtime will have those calls **404 offline** — some data-driven sections render empty. Layout + animations still work. Flag this in the scan `notes`.
- **Client-only navigation:** if a site navigates via JS with no real `<a href>`, route auto-discovery misses pages → rely on `_buildManifest.js` or manual route entry.
- **Auth / paywalls / captchas:** out of scope; don't try to bypass them.
- **Concurrency:** clone one site at a time initially; a job queue is a later enhancement.
- **Large media:** add a max-size / file-type filter so you don't pull gigabytes of video.
- **robots / rate-limiting:** add a small per-request delay; only clone sites you're allowed to. This is for studying design/animation on sites you have permission to copy.

---

## 11. Stretch goals

- Depth/scope controls (max pages, include/exclude path patterns).
- "Asset-only" mode (grab `_next/static` bundles without rendering every route).
- Diff mode: re-clone and highlight what changed since last capture.
- Export a single self-contained HTML per page (via `single-file` as an alternate engine).
- Save scan reports to history so you can re-run a clone later.

---

## 12. First commands to scaffold

```bash
npx create-next-app@latest site-cloner --typescript --tailwind --app --src-dir
cd site-cloner
npm i playwright
npx playwright install chromium
# then build out src/lib/cloner.ts from the existing capture.mjs
npm run dev   # open http://localhost:3000
```