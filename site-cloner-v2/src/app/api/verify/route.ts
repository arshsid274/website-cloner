import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { auditAssets } from "@/lib/assets";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Re-run the referenced-vs-present audit for an existing clone folder. */
export async function POST(req: Request) {
  let dir = "";
  let includeExternal = false;
  let models = true;
  try {
    ({ dir, includeExternal = false, models = true } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!dir || !fs.existsSync(dir)) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  // Recover the primary host from the manifest.
  let host = "";
  try {
    const m = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    );
    host = m.hostname || "";
  } catch {
    /* ignore */
  }
  if (!host) {
    return NextResponse.json(
      { error: "Could not determine host (missing manifest.json)" },
      { status: 400 },
    );
  }

  const audit = await auditAssets(dir, { host, includeExternal, models });
  return NextResponse.json(audit);
}
