import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { convertSection } from "@/lib/harvest";
import { slugifyHost } from "@/lib/paths";
import type { ConvertMode, HarvestedSection } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Convert one harvested section into a component on disk. */
export async function POST(req: Request) {
  let body: { dir: string; section: HarvestedSection; mode: ConvertMode };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { dir, section, mode } = body;
  if (!dir || !fs.existsSync(dir) || !section) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // Recover host → slug + the clone's web root for asset copying.
  let host = "";
  try {
    const m = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    );
    host = m.hostname || "";
  } catch {
    /* ignore */
  }
  const siteSlug = host ? slugifyHost(host) : "site";
  const cloneHostDir = host ? path.join(dir, host) : null;
  const outBase = path.join(dir, "harvested");

  try {
    const { componentPath } = await convertSection(
      section,
      mode || "pixel-port",
      outBase,
      siteSlug,
      cloneHostDir,
    );
    return NextResponse.json({ componentPath });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
