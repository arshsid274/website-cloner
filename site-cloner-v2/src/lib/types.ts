export type Framework =
  | "nextjs"
  | "nuxt"
  | "react"
  | "vue"
  | "astro"
  | "static"
  | "unknown";

export type AssetKind = "js" | "css" | "font" | "image" | "media" | "other";

export interface ScanReport {
  url: string;
  hostname: string;
  framework: Framework;
  routes: string[];
  assetCounts: Record<AssetKind, number>;
  estimatedBytes: number;
  notes: string[];
}

/** A render profile = viewport + device pixel ratio (drives srcset selection). */
export interface Profile {
  width: number;
  height: number;
  dpr: number;
}

export type ClonePhase =
  | "starting"
  | "page"
  | "render-profile"
  | "asset"
  | "sweep"
  | "verify"
  | "backfill"
  | "done"
  | "error";

export interface CloneProgress {
  phase: ClonePhase;
  currentUrl?: string;
  pagesDone: number;
  pagesTotal: number;
  filesSaved: number;
  bytesSaved: number;
  missingRemaining?: number;
  message?: string;
  outDir?: string;
  audit?: AssetAudit;
}

/** Referenced-vs-present asset audit — the v2 "0 missing" gate. */
export interface AssetAudit {
  referenced: number;
  present: number;
  missing: string[];
  external: string[];
  backfilled: number;
}

export interface ScanRequest {
  url: string;
}

export interface CloneRequest {
  url: string;
  routes: string[];
  settleMs?: number;
  exhaustive?: boolean;
  profiles?: Profile[];
  includeExternal?: boolean;
  models?: boolean;
}

export interface PreviewInfo {
  url: string;
  port: number;
  outDir: string;
}

/** A harvested page section ready to become a component. */
export interface HarvestedSection {
  id: string;
  label: string;
  html: string;
  computed: Record<string, Record<string, string>>;
  assets: string[];
  animationNotes: string[];
  rect: { width: number; height: number };
  componentPath?: string;
}

export type ConvertMode = "pixel-port" | "reference-rebuild";

/** A previously-downloaded clone, listed for re-import from Downloads. */
export interface CloneSummary {
  dir: string;
  hostname: string;
  capturedAt: string;
  filesSaved: number;
  bytesSaved: number;
  routes: string[];
  exhaustive?: boolean;
  audit?: AssetAudit;
  harvestedCount: number;
}

/** A harvested component file shown in the in-app showcase. */
export interface HarvestedComponent {
  name: string; // component name, e.g. "Hero"
  rel: string; // path under harvested/, e.g. "toyokoh-com/Hero.tsx"
  ext: string; // ".tsx" | ".jsx"
  slug: string; // folder under harvested/, e.g. "toyokoh-com"
  code: string; // the .tsx/.jsx source
  css?: string; // sibling .module.css, if any
  previewHtml?: string; // standalone preview (pixel-port only)
}
