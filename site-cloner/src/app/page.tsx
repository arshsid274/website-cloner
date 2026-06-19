"use client";

import { useCallback, useState } from "react";
import UrlInput from "@/components/UrlInput";
import ScanReportView from "@/components/ScanReport";
import ProgressPanel from "@/components/ProgressPanel";
import type { CloneProgress, ScanReport } from "@/lib/types";

export default function Home() {
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [cloning, setCloning] = useState(false);
  const [progress, setProgress] = useState<CloneProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [outDir, setOutDir] = useState<string | null>(null);

  const scan = useCallback(async (url: string) => {
    setScanning(true);
    setScanError(null);
    setReport(null);
    setProgress(null);
    setLog([]);
    setOutDir(null);
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
      next.has(route) ? next.delete(route) : next.add(route);
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
            if (p.message) {
              const tag =
                p.phase === "error"
                  ? "✗"
                  : p.phase === "page"
                    ? "▸"
                    : p.phase === "done"
                      ? "✓"
                      : "·";
              setLog((l) => [...l, `${tag} ${p.message}`]);
            }
          } catch {
            /* partial line — ignore */
          }
        }
      }
    } catch (e) {
      setLog((l) => [...l, `✗ ${(e as Error).message}`]);
    } finally {
      setCloning(false);
    }
  }, [report, selected]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:py-20">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">
          Site Cloner
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          Paste a URL, scan the domain, then clone it to your{" "}
          <span className="font-mono text-neutral-300">Downloads</span> folder
          with a real headless browser.
        </p>
      </header>

      <div className="space-y-6">
        <UrlInput onScan={scan} loading={scanning} />

        {scanError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            {scanError}
          </div>
        )}

        {report && (
          <ScanReportView
            report={report}
            selected={selected}
            onToggle={toggle}
            onAdd={add}
            onSelectAll={selectAll}
            onClone={clone}
            cloning={cloning}
          />
        )}

        <ProgressPanel progress={progress} log={log} outDir={outDir} />
      </div>

      <footer className="mt-12 text-center text-xs text-neutral-600">
        Only clone sites you have permission to copy. Runtime API data may 404
        offline.
      </footer>
    </main>
  );
}
