"use client";

import { useCallback, useState } from "react";
import UrlInput from "@/components/UrlInput";
import ScanReportView from "@/components/ScanReport";
import ProgressPanel from "@/components/ProgressPanel";
import PreviewButton from "@/components/PreviewButton";
import AssetAuditView from "@/components/AssetAudit";
import SectionPicker from "@/components/SectionPicker";
import ClonesLibrary from "@/components/ClonesLibrary";
import Showcase from "@/components/Showcase";
import type {
  AssetAudit,
  CloneProgress,
  CloneSummary,
  ScanReport,
} from "@/lib/types";

export default function Home() {
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // v2 capture options
  const [exhaustive, setExhaustive] = useState(true);
  const [includeExternal, setIncludeExternal] = useState(false);
  const [models, setModels] = useState(true);

  const [cloning, setCloning] = useState(false);
  const [progress, setProgress] = useState<CloneProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  // The "active" clone folder — set after a clone OR when imported from library.
  const [outDir, setOutDir] = useState<string | null>(null);
  const [audit, setAudit] = useState<AssetAudit | null>(null);
  const [copied, setCopied] = useState(false);
  const [showcaseKey, setShowcaseKey] = useState(0);

  const openClone = useCallback((c: CloneSummary) => {
    setOutDir(c.dir);
    setAudit(c.audit ?? null);
    setProgress(null);
    setLog([]);
    setShowcaseKey((k) => k + 1);
  }, []);

  const scan = useCallback(async (url: string) => {
    setScanning(true);
    setScanError(null);
    setReport(null);
    setProgress(null);
    setLog([]);
    setOutDir(null);
    setAudit(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      const rep = data as ScanReport;
      setReport(rep);
      setSelected(new Set(rep.routes));
    } catch (e) {
      setScanError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }, []);

  const toggle = (route: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(route)) next.delete(route);
      else next.add(route);
      return next;
    });

  const add = (route: string) => {
    if (!report) return;
    if (!report.routes.includes(route)) {
      setReport({ ...report, routes: [...report.routes, route].sort() });
    }
    setSelected((prev) => new Set(prev).add(route));
  };

  const selectAll = (all: boolean) =>
    setSelected(all && report ? new Set(report.routes) : new Set());

  const clone = useCallback(async () => {
    if (!report) return;
    setCloning(true);
    setLog([]);
    setOutDir(null);
    setAudit(null);
    setProgress({
      phase: "starting",
      pagesDone: 0,
      pagesTotal: selected.size,
      filesSaved: 0,
      bytesSaved: 0,
    });

    try {
      const res = await fetch("/api/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: report.url,
          routes: [...selected],
          exhaustive,
          includeExternal,
          models,
        }),
      });
      if (!res.body) throw new Error("No stream from server");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const line = evt.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const p = JSON.parse(line) as CloneProgress;
            setProgress(p);
            if (p.outDir) setOutDir(p.outDir);
            if (p.audit) setAudit(p.audit);
            if (p.message) {
              const tag =
                p.phase === "error"
                  ? "✗"
                  : p.phase === "page"
                    ? "▸"
                    : p.phase === "render-profile"
                      ? "▦"
                      : p.phase === "sweep" || p.phase === "backfill"
                        ? "⤓"
                        : p.phase === "verify"
                          ? "✔"
                          : p.phase === "done"
                            ? "✓"
                            : "·";
              setLog((l) => [...l, `${tag} ${p.message}`]);
            }
          } catch {
            /* partial line */
          }
        }
      }
    } catch (e) {
      setLog((l) => [...l, `✗ ${(e as Error).message}`]);
    } finally {
      setCloning(false);
    }
  }, [report, selected, exhaustive, includeExternal, models]);

  async function copyPath() {
    if (!outDir) return;
    await navigator.clipboard.writeText(outDir);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">
          Site Cloner <span className="text-indigo-400">v2</span>
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          Scan → clone every asset → verify → preview it running → harvest
          sections into React + Tailwind components.
        </p>
      </header>

      <div className="space-y-6">
        <UrlInput onScan={scan} loading={scanning} />

        <ClonesLibrary activeDir={outDir} onOpen={openClone} />

        {scanError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            {scanError}
          </div>
        )}

        {report && (
          <>
            <div className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={exhaustive}
                  onChange={(e) => setExhaustive(e.target.checked)}
                  className="h-4 w-4 accent-indigo-500"
                />
                <span className="text-neutral-200">
                  Download every asset (exhaustive)
                </span>
                <span className="text-xs text-neutral-500">
                  multi-DPR renders + static sweep + verify
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={includeExternal}
                  onChange={(e) => setIncludeExternal(e.target.checked)}
                  className="h-4 w-4 accent-indigo-500"
                />
                <span className="text-neutral-200">
                  Include external CDN assets
                </span>
                <span className="text-xs text-neutral-500">
                  off-origin fonts/scripts
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={models}
                  onChange={(e) => setModels(e.target.checked)}
                  className="h-4 w-4 accent-indigo-500"
                />
                <span className="text-neutral-200">
                  Download 3D / Three.js assets
                </span>
                <span className="text-xs text-neutral-500">
                  .glb, .gltf, .bin, .hdr, .ktx2…
                </span>
              </label>
            </div>

            <ScanReportView
              report={report}
              selected={selected}
              onToggle={toggle}
              onAdd={add}
              onSelectAll={selectAll}
              onClone={clone}
              cloning={cloning}
            />
          </>
        )}

        <ProgressPanel progress={progress} log={log} />

        {outDir && !cloning && (
          <div className="space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
            <div>
              <p className="mb-1 text-sm text-emerald-200">Active clone:</p>
              <p className="mb-3 break-all font-mono text-xs text-neutral-300">
                {outDir}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <PreviewButton outDir={outDir} />
                <button
                  onClick={copyPath}
                  className="rounded-lg border border-neutral-700 px-4 py-2 text-xs text-neutral-200 hover:bg-neutral-800"
                >
                  {copied ? "Copied!" : "Copy path"}
                </button>
                <button
                  onClick={() =>
                    fetch("/api/reveal", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ dir: outDir }),
                    })
                  }
                  className="rounded-lg border border-neutral-700 px-4 py-2 text-xs text-neutral-200 hover:bg-neutral-800"
                >
                  Reveal in folder
                </button>
              </div>
            </div>

            {audit && <AssetAuditView audit={audit} outDir={outDir} />}
            <SectionPicker
              outDir={outDir}
              onExported={() => setShowcaseKey((k) => k + 1)}
            />
            <Showcase outDir={outDir} refreshKey={showcaseKey} />
          </div>
        )}
      </div>

      <footer className="mt-12 text-center text-xs text-neutral-600">
        Only clone sites you have permission to copy. Runtime API data may 404
        offline; JS animations are re-authored, not harvested.
      </footer>
    </main>
  );
}
