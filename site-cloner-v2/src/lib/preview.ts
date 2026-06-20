import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import handler from "serve-handler";
import type { PreviewInfo } from "./types";

// outDir → running server. Persists in module scope for the dev server's life.
const servers = new Map<string, { server: http.Server; info: PreviewInfo }>();
const FIRST_PORT = 4321;

/**
 * The clone's web root is the host folder inside outDir, so that absolute
 * `/_astro/...`, `/_next/...` paths resolve to 200 with zero rewriting.
 */
function webRoot(outDir: string): string {
  try {
    const m = JSON.parse(
      fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"),
    );
    if (m.hostname) {
      const p = path.join(outDir, m.hostname);
      if (fs.existsSync(p)) return p;
    }
  } catch {
    /* fall through */
  }
  // Fallback: first subdirectory that contains an index.html.
  try {
    for (const e of fs.readdirSync(outDir, { withFileTypes: true })) {
      if (
        e.isDirectory() &&
        fs.existsSync(path.join(outDir, e.name, "index.html"))
      ) {
        return path.join(outDir, e.name);
      }
    }
  } catch {
    /* ignore */
  }
  return outDir;
}

function listenFree(server: http.Server, start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = start;
    const attempt = () => {
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && port < start + 100) {
          port++;
          attempt();
        } else {
          reject(err);
        }
      };
      server.once("error", onError);
      server.listen(port, () => {
        server.off("error", onError);
        resolve(port);
      });
    };
    attempt();
  });
}

export async function startPreview(outDir: string): Promise<PreviewInfo> {
  const existing = servers.get(outDir);
  if (existing) return existing.info;

  if (!fs.existsSync(outDir)) {
    throw new Error(`Output folder not found: ${outDir}`);
  }

  const root = webRoot(outDir);
  const server = http.createServer((req, res) => {
    // Allow the in-app component preview (served from a different port) to load
    // this clone's images/fonts cross-origin.
    res.setHeader("Access-Control-Allow-Origin", "*");
    handler(req, res, {
      public: root,
      directoryListing: false,
      headers: [
        {
          source: "**/*.@(js|mjs)",
          headers: [
            { key: "Content-Type", value: "text/javascript; charset=utf-8" },
          ],
        },
      ],
    });
  });

  const port = await listenFree(server, FIRST_PORT);
  const info: PreviewInfo = {
    url: `http://localhost:${port}`,
    port,
    outDir,
  };
  servers.set(outDir, { server, info });
  return info;
}

export function stopPreview(outDir: string): boolean {
  const entry = servers.get(outDir);
  if (!entry) return false;
  entry.server.close();
  servers.delete(outDir);
  return true;
}

export function getPreview(outDir: string): PreviewInfo | null {
  return servers.get(outDir)?.info ?? null;
}
