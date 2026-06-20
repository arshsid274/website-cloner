"use client";

import { useCallback, useEffect, useState } from "react";
import type { CloneSummary } from "@/lib/types";

interface Props {
  activeDir: string | null;
  onOpen: (summary: CloneSummary) => void;
}

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n > 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

export default function ClonesLibrary({ activeDir, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [clones, setClones] = useState<CloneSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/clones");
      const data = await res.json();
      setClones(Array.isArray(data) ? data : []);
    } catch {
      setError("Could not read the Downloads folder");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function openManual() {
    const dir = manual.trim();
    if (!dir) return;
    setError(null);
    try {
      // Reuse the verify endpoint as an existence/host probe.
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Folder not found or not a clone");
      }
      const audit = await res.json();
      onOpen({
        dir,
        hostname: dir.split("/").pop() || dir,
        capturedAt: "",
        filesSaved: 0,
        bytesSaved: 0,
        routes: [],
        audit,
        harvestedCount: 0,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3 text-left"
      >
        <span className="text-sm font-medium text-neutral-200">
          📂 Import a downloaded clone
        </span>
        <span className="text-xs text-neutral-500">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-neutral-800 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-neutral-500">
              Clones found in your Downloads folder
            </p>
            <button
              onClick={load}
              disabled={loading}
              className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {clones.length === 0 && !loading && (
            <p className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-4 text-sm text-neutral-500">
              No clones found yet. Clone a site, or open a folder by path below.
            </p>
          )}

          <div className="space-y-2">
            {clones.map((c) => {
              const isActive = activeDir === c.dir;
              return (
                <div
                  key={c.dir}
                  className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
                    isActive
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-neutral-800 bg-neutral-900/60"
                  }`}
                >
                  <span className="font-mono text-sm text-neutral-200">
                    {c.hostname}
                  </span>
                  <span className="text-[11px] text-neutral-500">
                    {c.filesSaved} files · {fmtBytes(c.bytesSaved)}
                    {c.harvestedCount > 0 && ` · ${c.harvestedCount} components`}
                    {c.audit &&
                      ` · ${c.audit.missing.length === 0 ? "complete ✓" : `${c.audit.missing.length} missing`}`}
                  </span>
                  <button
                    onClick={() => onOpen(c)}
                    className="ml-auto rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
                  >
                    {isActive ? "Reopen" : "Open"}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="…or paste a clone folder path"
              className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900/80 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
            />
            <button
              onClick={openManual}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-xs text-neutral-200 hover:bg-neutral-800"
            >
              Open path
            </button>
          </div>

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
