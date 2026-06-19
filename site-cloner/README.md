# Site Cloner

A local web app: paste a URL, **scan** the domain (framework, routes, asset
inventory), then **clone** it with a real headless browser (Playwright) and
save it to `~/Downloads/<website-name>/`.

Built per [`../plan.md`](../plan.md) — Option A (Next.js App Router + React 19 +
TypeScript + Tailwind, Playwright backend over `localhost`).

## Why it's a local app, not a static page

A normal browser tab can't write to your `Downloads` folder or drive
Playwright — the sandbox forbids both. So the backend runs as Next.js Route
Handlers (Node runtime) that launch Chromium and write files; the React UI
talks to it over `localhost`.

## Setup

```bash
cd site-cloner
npm install            # installs deps + Chromium (postinstall)
npm run dev            # http://localhost:3000
```

If the postinstall step is skipped, run `npx playwright install chromium` once.

## Use

1. Paste `https://www.example.com/` and click **Scan**.
2. Review the framework badge, asset breakdown, and discovered routes. Tick the
   routes you want; add custom ones with the input.
3. Click **Clone**. Live progress streams in over Server-Sent Events.
4. Files land in `~/Downloads/<slugified-host>/`. Use **Copy path** or **Reveal
   in folder**.

Override the destination with `CLONE_OUT_DIR=/some/dir npm run dev`.

## Previewing animations (important)

Scroll/entry animations are driven by the site's **JavaScript**, and that JS
only runs when the page is served over **HTTP** — opening `index.html` straight
from `file://` blocks module scripts and asset fetches, so nothing animates.

Every clone ships a zero-dependency static server. From the clone folder:

```bash
cd ~/Downloads/<slug>/        # the folder shown in the UI
node serve.mjs                # → http://localhost:4321
```

The UI's done-state shows the exact command (click to copy). To make this work
the cloner:

- saves the **pristine server HTML** (initial state), *not* the post-scroll DOM
  — so libraries like GSAP ScrollTrigger / Framer Motion replay from the start
  instead of appearing already-finished;
- captures the HTML **before** the asset-harvesting scroll, so no end-state
  transforms/opacity get baked into the markup;
- rewrites same-origin URLs to **root-relative** so the saved `_next/static`
  chunks resolve under `serve.mjs` and execute with correct MIME types.

## How it works

| File | Role |
|---|---|
| `src/lib/scanner.ts` | Playwright scan: framework detection, route discovery (Next `_buildManifest.js` + anchor scan), asset inventory. |
| `src/lib/cloner.ts` | Core capture: saves every same-domain network response at its original path, renders post-JS HTML per route, auto-scrolls for lazy-load, writes `manifest.json`. |
| `src/lib/paths.ts` | Downloads dir, host slug, collision timestamps, path-safety (`..` traversal blocked). |
| `src/app/api/scan` | `POST` → `ScanReport` JSON. |
| `src/app/api/clone` | `POST` → SSE stream of `CloneProgress`. |
| `src/app/api/reveal` | `POST` → opens the folder in Finder/Explorer. |

Both Playwright routes pin `runtime = "nodejs"` (Edge can't run Chromium).

## Limitations

- **Runtime API data** 404s offline — data-driven sections may render empty;
  layout + animations still work. Flagged in scan notes.
- **Client-only navigation** with no real `<a href>` can hide routes — rely on
  `_buildManifest.js` or add routes manually.
- Auth / paywalls / captchas are out of scope. Large media is capped at 25 MB
  per asset. Clone one site at a time.
- Only clone sites you're allowed to copy.
