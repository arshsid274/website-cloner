import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { synthesizePreview } from "@/lib/harvest";
import { startPreview } from "@/lib/preview";

export const runtime = "nodejs";

/**
 * Serve a full-page, navigable preview of a harvested component. Used both by
 * the showcase iframe and the "Open in new tab" button. Injects a <base> at the
 * running clone server so original asset paths resolve, and points copied
 * ./assets/ at the asset endpoint.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dir = url.searchParams.get("dir") || "";
  const rel = url.searchParams.get("rel") || ""; // e.g. "toyokoh-com/Hero.tsx"
  if (!dir || !rel) return new Response("Bad request", { status: 400 });

  const file = path.resolve(path.join(dir, "harvested", rel));
  const root = path.resolve(path.join(dir, "harvested"));
  if (file !== root && !file.startsWith(root + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });

  const ext = path.extname(file);
  const name = path.basename(file, ext);
  const folder = path.dirname(file);
  const slug = path.relative(root, folder) || ".";
  const previewPath = path.join(folder, `${name}.preview.html`);
  const cssPath = path.join(folder, `${name}.module.css`);

  let doc: string | undefined = fs.existsSync(previewPath)
    ? await fsp.readFile(previewPath, "utf8").catch(() => undefined)
    : undefined;
  if (!doc) {
    const code = await fsp.readFile(file, "utf8").catch(() => "");
    const css = fs.existsSync(cssPath)
      ? await fsp.readFile(cssPath, "utf8").catch(() => undefined)
      : undefined;
    doc = synthesizePreview(code, css) ?? undefined;
  }
  if (!doc) {
    return new Response(
      "<!doctype html><meta charset=utf-8><body style='font:14px system-ui;padding:2rem'>No preview available for this component (reference-rebuild components are source-only).",
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  // Copied assets → absolute asset endpoint on THIS origin (immune to <base>).
  const assetApi = `${url.origin}/api/harvested/asset?dir=${encodeURIComponent(dir)}&rel=${slug}/assets/`;
  doc = doc.split("./assets/").join(assetApi);

  // Original absolute paths resolve from the live clone server.
  try {
    const preview = await startPreview(dir);
    doc = doc.replace(/<head>/i, `<head>\n<base href="${preview.url}/" />`);
  } catch {
    /* preview server optional; copied assets still resolve */
  }

  return new Response(doc, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
