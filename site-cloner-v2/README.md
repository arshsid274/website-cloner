# Site Cloner v2

A local app that **scans → clones (completely) → verifies → previews → harvests
into React + Tailwind components.** Built per [`../plan-v2.md`](../plan-v2.md).

v2 keeps everything v1 did (Playwright render, save-by-original-path, SSE
progress, pristine-HTML animation capture) and adds three stages that fix the
three failures found testing v1 on a real Astro site (`toyokoh.com`):

| v1 failure | v2 fix |
|---|---|
| Double-click clone = broken CSS / dead animations (`file://` has no web root) | **Preview server** — the clone is only ever viewed over `http://localhost` |
| 63% of assets missing (mostly `@2x` / breakpoint images) | **Exhaustive capture + verify gate** — multi-DPR renders + static sweep, looped until `missing: []` |
| Cloned HTML hard to turn into components (scoped hashes, external styles) | **Harvest pipeline** — sections + `getComputedStyle` → components |

## Setup

```bash
cd site-cloner-v2
npm install            # deps + Chromium (postinstall)
npm run dev            # http://localhost:3000
```

## Flow

```
paste URL → SCAN → CLONE (3-pass) → VERIFY (0 missing) → PREVIEW (http) → HARVEST (sections → components)
```

1. **Scan** — framework, routes, asset inventory. Notes a srcset multiplier so
   the size estimate accounts for responsive variants.
2. **Clone** — toggle **Download every asset (exhaustive)** (on by default):
   - **Pass A** reactive capture (every network response saved by original path)
   - **Pass B** re-renders each route at retina/tablet/mobile DPR profiles so the
     browser fetches `@2x`/`@3x`/breakpoint srcset candidates
   - **Pass C** static sweep — parses every saved html+css, **expands srcset**,
     resolves `url(...)` **against the referencing file**, and fetches anything
     same-origin still missing (recursing into freshly-fetched CSS)
   - **Video/audio** (`Download every asset`) and **3D / Three.js assets**
     (`Download 3D / Three.js assets`, on by default) are also captured: the
     sweep finds media/model paths even when they're lazy-loaded from a
     `data-src` JSON blob or a string literal inside a JS bundle, follows a
     fetched `.gltf` to its `.bin` buffers + textures, and lifts the size cap
     to 300 MB for these. Files: `.mp4/.webm/...`, `.glb/.gltf/.bin/.hdr/.ktx2/…`
   - **Verify gate** loops sweep+audit until `missing: []`
3. **Open Preview** — starts a static server rooted at the clone's host folder,
   so absolute `/_astro`, `/_next` paths resolve to 200 with zero rewriting, and
   the site actually runs (JS + animations).
4. **Asset audit** — referenced / present / missing / backfilled / external,
   with a **Re-verify** button.
5. **Harvest** — segments the live preview into sections (unwrapping framework
   layout wrappers, expanding oversized containers). Each section captures
   cleaned HTML + a computed-style map + its assets + animation notes. **Export**
   a section as a component:
   - **pixel-port** (default, no API): faithful CSS-module component built from
     the computed styles + copied assets. Works offline.
   - **reference-rebuild** (needs `ANTHROPIC_API_KEY`): idiomatic Tailwind via
     Claude.
   Output: `<outDir>/harvested/<site>/<Section>.tsx` (+ `.module.css`,
   `.preview.html`, `assets/`).

### Import a previous download

**📂 Import a downloaded clone** (top of the page) lists every clone already in
your Downloads folder (any folder with a `manifest.json`) — click **Open** to
make it the active clone without re-cloning, or paste a folder path directly.
Opening one restores its audit and unlocks Preview / Harvest / Showcase.

### In-app component showcase

Once a clone is active, **🎛 Component showcase** lists every harvested
component with three tabs:

- **Preview** — a live render of the section in a sandboxed iframe. Harvest
  first **scrolls the page** so entry/scroll-reveal animations fire and lazy
  images load, then captures the *visible final state* (otherwise the static
  component would be frozen at its initial `opacity:0` and render blank). The
  iframe points a `<base>` at the running clone server so every image/font/video
  resolves live, with copied `./assets/` served via `/api/harvested/asset`.
  **⤢ Open in new tab** opens the same render full-screen at its own URL
  (`/api/harvested/preview`) — handy for inspecting a section on its own.
- **Code (.tsx/.jsx)** — the component source, with copy.
- **Styles** — the `.module.css`, with copy.

Export a section from Harvest and it appears here immediately.

Override the clone destination (and the library's source folder) with
`CLONE_OUT_DIR=/some/dir npm run dev`.

## Map

| File | Role |
|---|---|
| `lib/scanner.ts` | framework (incl. Astro) + route + asset scan, srcset note |
| `lib/cloner.ts` | passes A+B, pristine-HTML capture, calls the verify gate |
| `lib/assets.ts` | pass C static sweep + `auditAssets` + `exhaustiveVerify` loop |
| `lib/preview.ts` | `serve-handler` static server keyed by outDir |
| `lib/harvest.ts` | section segmentation, `getComputedStyle` capture, convert, `.preview.html` |
| `api/clones` | GET — list downloaded clones for re-import |
| `api/harvested` | GET — list a clone's harvested components (code/css/preview) |
| `api/harvested/asset` | GET — serve a harvested asset (sandboxed) for previews |
| `api/{scan,clone,preview,verify,harvest,harvest/convert,reveal}` | endpoints |

## Limitations (honest)

- **Runtime API data** still 404s offline — layout/styles fine, data-driven
  lists may render empty (flagged in scan notes).
- **External CDN assets** off by default; enable "Include external CDN assets".
- **JS animations don't harvest** — they're recorded as `animationNotes` and
  re-authored (Framer Motion / GSAP), not copied. Inherent, not a bug.
- **Exhaustive mode is slower** (N profiles × routes + sweep). A 25 MB per-asset
  cap keeps it from pulling gigabytes of video.
- The verify gate can finish with `missing > 0` if the source itself 404s those
  references (e.g. dead links to old PDFs) — that's reported, not hidden.
- Only clone sites you have permission to copy.
