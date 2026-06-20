"use client";

import { useState } from "react";
import type { AssetAudit } from "@/lib/types";

interface Props {
  audit: AssetAudit;
  outDir: string;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "bad" | "neutral";
}) {
  const color =
    tone === "ok"
      ? "text-emerald-300"
      : tone === "bad"
        ? "text-red-300"
        : tone === "warn"
          ? "text-amber-300"
          : "text-neutral-200";
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-center">
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </div>
    </div>
  );
}

export default function AssetAuditView({ audit: initial, outDir }: Props) {
  const [audit, setAudit] = useState(initial);
  const [reverifying, setReverifying] = useState(false);
  const clean = audit.missing.length === 0;

  async function reverify() {
    setReverifying(true);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: outDir }),
      });
      const data = await res.json();
      if (res.ok) setAudit(data);
    } finally {
      setReverifying(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-200">
          Asset audit{" "}
          <span className={clean ? "text-emerald-400" : "text-red-400"}>
            {clean ? "· complete ✓" : `· ${audit.missing.length} missing`}
          </span>
        </h3>
        <button
          onClick={reverify}
          disabled={reverifying}
          className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
        >
          {reverifying ? "Re-verifying…" : "Re-verify"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Stat label="referenced" value={audit.referenced} tone="neutral" />
        <Stat label="present" value={audit.present} tone="ok" />
        <Stat
          label="missing"
          value={audit.missing.length}
          tone={clean ? "ok" : "bad"}
        />
        <Stat label="backfilled" value={audit.backfilled} tone="warn" />
        <Stat label="external" value={audit.external.length} tone="neutral" />
      </div>

      {audit.missing.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-neutral-400">
            Show missing ({audit.missing.length})
          </summary>
          <div className="scroll-thin mt-2 max-h-32 overflow-y-auto rounded bg-black/40 p-2 font-mono text-[11px] text-red-300/80">
            {audit.missing.slice(0, 200).map((m, i) => (
              <div key={i} className="break-all">
                {m}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
