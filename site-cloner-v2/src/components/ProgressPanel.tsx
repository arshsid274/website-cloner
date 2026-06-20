"use client";

import { useEffect, useRef } from "react";
import type { CloneProgress } from "@/lib/types";

interface Props {
  progress: CloneProgress | null;
  log: string[];
}

const PHASE_LABEL: Record<string, string> = {
  starting: "Starting",
  page: "Rendering pages",
  "render-profile": "Multi-DPR render (pass B)",
  asset: "Saving assets",
  sweep: "Static sweep (pass C)",
  backfill: "Backfilling missing",
  verify: "Verifying",
  done: "Done",
  error: "Error",
};

export default function ProgressPanel({ progress, log }: Props) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  if (!progress) return null;

  const pct =
    progress.pagesTotal > 0
      ? Math.min(
          100,
          Math.round((progress.pagesDone / progress.pagesTotal) * 100),
        )
      : 0;
  const done = progress.phase === "done";

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-neutral-300">
          <span className="text-neutral-500">
            {PHASE_LABEL[progress.phase] ?? progress.phase} ·{" "}
          </span>
          {progress.pagesDone}/{progress.pagesTotal} pages · {progress.filesSaved}{" "}
          files · {(progress.bytesSaved / 1e6).toFixed(1)} MB
          {typeof progress.missingRemaining === "number" && (
            <span
              className={
                progress.missingRemaining === 0
                  ? "text-emerald-400"
                  : "text-amber-400"
              }
            >
              {" "}
              · {progress.missingRemaining} missing
            </span>
          )}
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
        className="scroll-thin mt-4 h-44 overflow-y-auto rounded-lg border border-neutral-800 bg-black/40 p-3 font-mono text-xs leading-relaxed text-neutral-400"
      >
        {log.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
