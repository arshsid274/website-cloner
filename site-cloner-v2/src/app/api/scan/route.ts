import { NextResponse } from "next/server";
import { scanSite } from "@/lib/scanner";
import type { ScanRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  let body: ScanRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = (body.url || "").trim();
  if (!isHttpUrl(url)) {
    return NextResponse.json(
      { error: "Provide a valid http(s) URL" },
      { status: 400 },
    );
  }

  try {
    const report = await scanSite(url);
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: `Scan failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
