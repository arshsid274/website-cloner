"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HarvestedComponent } from "@/lib/types";

interface Props {
  outDir: string;
  /** bump to force a reload after a new export */
  refreshKey?: number;
}

type Tab = "preview" | "code" | "styles";

export default function Showcase({ outDir, refreshKey }: Props) {
  const [items, setItems] = useState<HarvestedComponent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("preview");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/harvested?dir=${encodeURIComponent(outDir)}`,
      );
      const data: HarvestedComponent[] = await res.json();
      setItems(Array.isArray(data) ? data : []);
      setSelected((cur) => cur ?? data[0]?.rel ?? null);
    } finally {
      setLoading(false);
    }
  }, [outDir]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const current = useMemo(
    () => items.find((i) => i.rel === selected) ?? null,
    [items, selected],
  );

  // Default a reference-rebuild (no preview html) component to the Code tab.
  useEffect(() => {
    if (current && !current.previewHtml && tab === "preview") setTab("code");
  }, [current, tab]);

  // A navigable URL that renders the full preview (base href + asset rewrites
  // applied server-side). Used by both the iframe and "Open in new tab".
  const previewUrl = useMemo(() => {
    if (!current?.previewHtml) return "";
    return `/api/harvested/preview?dir=${encodeURIComponent(outDir)}&rel=${encodeURIComponent(current.rel)}`;
  }, [current, outDir]);

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-200">
          🎛 Component showcase{" "}
          <span className="text-neutral-500">({items.length})</span>
        </h3>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-4 text-sm text-neutral-500">
          No components yet. Use{" "}
          <span className="text-neutral-300">Harvest sections</span> above and
          export one, then refresh.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          {/* menu */}
          <div className="scroll-thin max-h-[420px] overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900/60">
            {items.map((it) => (
              <button
                key={it.rel}
                onClick={() => setSelected(it.rel)}
                className={`block w-full border-b border-neutral-800/60 px-3 py-2 text-left text-sm last:border-0 ${
                  it.rel === selected
                    ? "bg-indigo-500/15 text-indigo-200"
                    : "text-neutral-300 hover:bg-neutral-800/50"
                }`}
              >
                <span className="font-mono">{it.name}</span>
                <span className="ml-1 text-[10px] text-neutral-500">
                  {it.ext}
                </span>
                {it.slug !== "." && (
                  <div className="truncate text-[10px] text-neutral-600">
                    {it.slug}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* viewer */}
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-1">
              {(["preview", "code", "styles"] as Tab[]).map((t) => {
                const disabled =
                  (t === "preview" && !current?.previewHtml) ||
                  (t === "styles" && !current?.css);
                return (
                  <button
                    key={t}
                    disabled={disabled}
                    onClick={() => setTab(t)}
                    className={`rounded px-3 py-1 text-xs capitalize ${
                      tab === t
                        ? "bg-neutral-700 text-white"
                        : "text-neutral-400 hover:text-neutral-200"
                    } disabled:cursor-not-allowed disabled:opacity-30`}
                  >
                    {t === "code" ? `Code (${current?.ext ?? ".tsx"})` : t}
                  </button>
                );
              })}
              {tab === "preview" && previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto rounded border border-indigo-600/60 bg-indigo-600/10 px-2 py-1 text-xs text-indigo-300 hover:bg-indigo-600/20"
                  title="Open full-screen in a new tab"
                >
                  ⤢ Open in new tab
                </a>
              )}
              <button
                onClick={() =>
                  copy(tab === "styles" ? current?.css ?? "" : current?.code ?? "")
                }
                className={`${tab === "preview" ? "" : "ml-auto "}rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800`}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            {tab === "preview" && previewUrl && (
              <iframe
                title={`${current?.name ?? ""} preview`}
                src={previewUrl}
                sandbox="allow-same-origin"
                className="h-[420px] w-full rounded-lg border border-neutral-800 bg-white"
              />
            )}

            {tab === "code" && (
              <pre className="scroll-thin h-[420px] overflow-auto rounded-lg border border-neutral-800 bg-black/50 p-3 text-[11px] leading-relaxed text-neutral-300">
                <code>{current?.code}</code>
              </pre>
            )}

            {tab === "styles" && current?.css && (
              <pre className="scroll-thin h-[420px] overflow-auto rounded-lg border border-neutral-800 bg-black/50 p-3 text-[11px] leading-relaxed text-neutral-300">
                <code>{current.css}</code>
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
