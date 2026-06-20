import { NextResponse } from "next/server";
import { getPreview, startPreview, stopPreview } from "@/lib/preview";

export const runtime = "nodejs";

/** Start (or reuse) a static preview server for a clone folder. */
export async function POST(req: Request) {
  let dir = "";
  try {
    ({ dir } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!dir) {
    return NextResponse.json({ error: "Missing dir" }, { status: 400 });
  }
  try {
    const info = await startPreview(dir);
    return NextResponse.json(info);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/** Stop a running preview server. */
export async function DELETE(req: Request) {
  let dir = "";
  try {
    ({ dir } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const stopped = stopPreview(dir);
  return NextResponse.json({ stopped });
}

/** Report whether a preview is currently running for a folder. */
export async function GET(req: Request) {
  const dir = new URL(req.url).searchParams.get("dir") || "";
  return NextResponse.json({ preview: getPreview(dir) });
}
