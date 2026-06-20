import { NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { downloadsDir } from "@/lib/paths";
import type { CloneSummary } from "@/lib/types";

export const runtime = "nodejs";

/** List previously-downloaded clones (folders with a manifest.json). */
export async function GET(req: Request) {
  // Allow an explicit base via ?base=, else the Downloads dir (CLONE_OUT_DIR).
  const base = new URL(req.url).searchParams.get("base") || downloadsDir();
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(base, { withFileTypes: true });
  } catch {
    return NextResponse.json([]);
  }

  const out: CloneSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(base, e.name);
    const mf = path.join(dir, "manifest.json");
    if (!fs.existsSync(mf)) continue;
    try {
      const m = JSON.parse(await fsp.readFile(mf, "utf8"));
      out.push({
        dir,
        hostname: m.hostname || e.name,
        capturedAt: m.capturedAt || "",
        filesSaved: m.filesSaved || 0,
        bytesSaved: m.bytesSaved || 0,
        routes: m.routes || [],
        exhaustive: m.exhaustive,
        audit: m.audit,
        harvestedCount: countComponents(path.join(dir, "harvested")),
      });
    } catch {
      /* skip unreadable manifest */
    }
  }

  out.sort((a, b) => (b.capturedAt || "").localeCompare(a.capturedAt || ""));
  return NextResponse.json(out);
}

function countComponents(dir: string): number {
  let n = 0;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) n += countComponents(fp);
    else if (/\.(tsx|jsx)$/i.test(e.name)) n++;
  }
  return n;
}
