"use client";

import type { ScanReport } from "@/lib/types";
import RouteList from "./RouteList";

interface Props {
  report: ScanReport;
  selected: Set<string>;
  onToggle: (route: string) => void;
  onAdd: (route: string) => void;
  onSelectAll: (all: boolean) => void;
  onClone: () => void;
  cloning: boolean;
}

const FRAMEWORK_LABEL: Record<string, string> = {
  nextjs: "Next.js",
  nuxt: "Nuxt",
  react: "React",
  vue: "Vue",
  static: "Static / SSR",
  unknown: "Unknown",
};

function fmtBytes(n: number): string {
  if (!n) return "unknown";
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n > 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

export default function ScanReportView({
  report,
  selected,
  onToggle,
  onAdd,
  onSelectAll,
  onClone,
  cloning,
}: Props) {
  const counts = report.assetCounts;
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-indigo-500/15 px-3 py-1 text-xs font-medium text-indigo-300 ring-1 ring-indigo-500/30">
          {FRAMEWORK_LABEL[report.framework] ?? report.framework}
        </span>
        <span className="font-mono text-sm text-neutral-400">
          {report.hostname}
        </span>
        <span className="ml-auto text-xs text-neutral-500">
          est. {fmtBytes(report.estimatedBytes)}
        </span>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {(Object.keys(counts) as (keyof typeof counts)[]).map((k) => (
          <div
            key={k}
            className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-2 py-2 text-center"
          >
            <div className="text-lg font-semibold text-neutral-200">
              {counts[k]}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              {k}
            </div>
          </div>
        ))}
      </div>

      {report.notes.length > 0 && (
        <ul className="mb-5 space-y-1">
          {report.notes.map((n, i) => (
            <li
              key={i}
              className="rounded-md border-l-2 border-amber-500/50 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-200/80"
            >
              {n}
            </li>
          ))}
        </ul>
      )}

      <RouteList
        routes={report.routes}
        selected={selected}
        onToggle={onToggle}
        onAdd={onAdd}
        onSelectAll={onSelectAll}
      />

      <button
        onClick={onClone}
        disabled={cloning || selected.size === 0}
        className="mt-5 w-full rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {cloning
          ? "Cloning…"
          : `Clone ${selected.size} route${selected.size === 1 ? "" : "s"} → Downloads`}
      </button>
    </div>
  );
}
