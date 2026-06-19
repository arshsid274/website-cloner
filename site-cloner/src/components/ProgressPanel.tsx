"use client";

import { useEffect, useRef, useState } from "react";
import type { CloneProgress } from "@/lib/types";

interface Props {
  progress: CloneProgress | null;
  log: string[];
  outDir: string | null;
}

export default function ProgressPanel({ progress, log, outDir }: Props) {
  const logRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [serveCopied, setServeCopied] = useState(false);

  const serveCmd = outDir ? `cd "${outDir}" && node serve.mjs` : "";

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  if (!progress) return null;

  const pct =
    progress.pagesTotal > 0
      ? Math.min(100, Math.round((progress.pagesDone / progress.pagesTotal) * 100))
      : 0;
  const done = progress.phase === "done";

  async function copyPath() {
    if (!outDir) return;
    await navigator.clipboard.writeText(outDir);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function copyServe() {
    if (!serveCmd) return;
    await navigator.clipboard.writeText(serveCmd);
    setServeCopied(true);
    setTimeout(() => setServeCopied(false), 1500);
  }

  async function reveal() {
    if (!outDir) return;
    await fetch("/api/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir: outDir }),
    });
  }

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-neutral-300">
          {progress.pagesDone}/{progress.pagesTotal} pages · {progress.filesSaved}{" "}
          files · {(progress.bytesSaved / 1e6).toFixed(1)} MB
        </span>
        <span className={done ? "text-emerald-400" : "text-indigo-400"}>
          {pct}%
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            done ? "bg-emerald-500" : "bg-indigo-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div
        ref={logRef}
        className="scroll-thin mt-4 h-48 overflow-y-auto rounded-lg border border-neutral-800 bg-black/40 p-3 font-mono text-xs leading-relaxed text-neutral-400"
      >
        {log.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))}
      </div>

      {done && outDir && (
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="mb-2 text-sm text-emerald-200">Saved to:</p>
          <p className="mb-3 break-all font-mono text-xs text-neutral-300">
            {outDir}
          </p>
          <div className="mb-4 flex gap-2">
            <button
              onClick={copyPath}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-xs text-neutral-200 hover:bg-neutral-800"
            >
              {copied ? "Copied!" : "Copy path"}
            </button>
            <button
              onClick={reveal}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
            >
              Reveal in folder
            </button>
          </div>

          <div className="rounded-md border border-indigo-500/30 bg-indigo-500/5 p-3">
            <p className="mb-1.5 text-xs font-medium text-indigo-200">
              ▶ Preview WITH animations
            </p>
            <p className="mb-2 text-[11px] leading-relaxed text-neutral-400">
              Animations need the site&apos;s JS to run, which requires HTTP —
              opening the file directly won&apos;t animate. Run this:
            </p>
            <button
              onClick={copyServe}
              className="w-full rounded bg-black/50 px-3 py-2 text-left font-mono text-[11px] text-emerald-300 hover:bg-black/70"
              title="Click to copy"
            >
              {serveCopied ? "Copied!" : serveCmd}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
