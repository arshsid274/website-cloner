import { exec } from "node:child_process";
import fs from "node:fs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Open the cloned folder in the OS file manager. */
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

  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open";

  exec(`${cmd} "${dir.replace(/"/g, '')}"`);
  return NextResponse.json({ ok: true });
}
