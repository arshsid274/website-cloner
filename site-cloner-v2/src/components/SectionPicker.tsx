"use client";

import { useState } from "react";
import type { ConvertMode, HarvestedSection } from "@/lib/types";

interface Props {
  outDir: string;
  /** Called after a section is successfully exported to a component. */
  onExported?: () => void;
}

interface RowState {
  mode: ConvertMode;
  status: "idle" | "converting" | "done" | "error";
  result?: string;
}

export default function SectionPicker({ outDir, onExported }: Props) {
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<HarvestedSection[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [error, setError] = useState<string | null>(null);

  async function harvest() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/harvest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: outDir }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Harvest failed");
      setSections(data.sections);
      const init: Record<string, RowState> = {};
      for (const s of data.sections as HarvestedSection[])
        init[s.id] = { mode: "pixel-port", status: "idle" };
      setRows(init);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function convert(section: HarvestedSection) {
    setRows((r) => ({ ...r, [section.id]: { ...r[section.id], status: "converting" } }));
    try {
      const res = await fetch("/api/harvest/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dir: outDir,
          section,
          mode: rows[section.id]?.mode || "pixel-port",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Convert failed");
      setRows((r) => ({
        ...r,
        [section.id]: { ...r[section.id], status: "done", result: data.componentPath },
      }));
      onExported?.();
    } catch (e) {
      setRows((r) => ({
        ...r,
        [section.id]: { ...r[section.id], status: "error", result: (e as Error).message },
      }));
    }
  }

  if (!sections) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-neutral-200">
              Harvest → components
            </h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              Segment the clone into sections and export each as a React
              component with its computed styles.
            </p>
          </div>
          <button
            onClick={harvest}
            disabled={loading}
            className="rounded-lg bg-fuchsia-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-fuchsia-500 disabled:opacity-50"
          >
            {loading ? "Harvesting…" : "Harvest sections"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h3 className="mb-3 text-sm font-medium text-neutral-200">
        Sections <span className="text-neutral-500">({sections.length})</span>
      </h3>
      <div className="space-y-2">
        {sections.map((s) => {
          const row = rows[s.id];
          return (
            <div
              key={s.id}
              className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-neutral-200">
                  {s.label}
                </span>
                <span className="text-[10px] text-neutral-500">
                  {s.rect.width}×{s.rect.height}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <select
                    value={row?.mode}
                    onChange={(e) =>
                      setRows((r) => ({
                        ...r,
                        [s.id]: { ...r[s.id], mode: e.target.value as ConvertMode },
                      }))
                    }
                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300"
                  >
                    <option value="pixel-port">pixel-port (no API)</option>
                    <option value="reference-rebuild">
                      reference-rebuild (Claude)
                    </option>
                  </select>
                  <button
                    onClick={() => convert(s)}
                    disabled={row?.status === "converting"}
                    className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {row?.status === "converting" ? "…" : "Export"}
                  </button>
                </div>
              </div>

              {s.animationNotes.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {s.animationNotes.map((n, i) => (
                    <li key={i} className="text-[11px] text-amber-200/70">
                      ⚡ {n}
                    </li>
                  ))}
                </ul>
              )}

              {row?.status === "done" && (
                <p className="mt-2 break-all font-mono text-[11px] text-emerald-300">
                  ✓ {row.result}
                </p>
              )}
              {row?.status === "error" && (
                <p className="mt-2 text-[11px] text-red-400">✗ {row.result}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
