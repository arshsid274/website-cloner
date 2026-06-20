import { NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { synthesizePreview } from "@/lib/harvest";
import type { HarvestedComponent } from "@/lib/types";

export const runtime = "nodejs";

/** GET ?dir=…: list harvested components (code + css + standalone preview). */
export async function GET(req: Request) {
  const dir = new URL(req.url).searchParams.get("dir") || "";
  if (!dir || !fs.existsSync(dir)) {
    return NextResponse.json([]);
  }
  const base = path.join(dir, "harvested");
  const files = await walk(base);
  const out: HarvestedComponent[] = [];

  for (const file of files) {
    if (!/\.(tsx|jsx)$/i.test(file)) continue;
    const ext = path.extname(file);
    const name = path.basename(file, ext);
    const folder = path.dirname(file);
    const slug = path.relative(base, folder) || ".";
    const cssPath = path.join(folder, `${name}.module.css`);
    const previewPath = path.join(folder, `${name}.preview.html`);

    const code = await fsp.readFile(file, "utf8").catch(() => "");
    const css = fs.existsSync(cssPath)
      ? await fsp.readFile(cssPath, "utf8").catch(() => undefined)
      : undefined;
    // Prefer the on-disk preview; otherwise synthesize it from the component's
    // embedded HTML + CSS module so older exports still preview.
    let previewHtml = fs.existsSync(previewPath)
      ? await fsp.readFile(previewPath, "utf8").catch(() => undefined)
      : undefined;
    if (!previewHtml) previewHtml = synthesizePreview(code, css) ?? undefined;

    out.push({
      name,
      rel: path.relative(base, file),
      ext,
      slug,
      code,
      css,
      previewHtml,
    });
  }

  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return NextResponse.json(out);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(fp)));
    else out.push(fp);
  }
  return out;
}
