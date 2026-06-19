export type Framework =
  | "nextjs"
  | "nuxt"
  | "react"
  | "vue"
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

export type ClonePhase =
  | "starting"
  | "page"
  | "asset"
  | "done"
  | "error";

export interface CloneProgress {
  phase: ClonePhase;
  currentUrl?: string;
  pagesDone: number;
  pagesTotal: number;
  filesSaved: number;
  bytesSaved: number;
  message?: string;
  outDir?: string;
}

export interface ScanRequest {
  url: string;
}

export interface CloneRequest {
  url: string;
  routes: string[];
  settleMs?: number;
}
