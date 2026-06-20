import { NextResponse } from "next/server";
import fs from "node:fs";
import { harvestSections } from "@/lib/harvest";
import { startPreview } from "@/lib/preview";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Segment a clone into sections (starts a preview server if needed). */
export async function POST(req: Request) {
  let dir = "";
  try {
    ({ dir } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!dir || !fs.existsSync(dir)) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  try {
    const preview = await startPreview(dir);
    const sections = await harvestSections(preview.url);
    return NextResponse.json({ previewUrl: preview.url, sections });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
