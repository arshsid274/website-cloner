"use client";

import { useState } from "react";

interface Props {
  outDir: string;
}

/** Starts the static preview server for a clone and opens it in a new tab. */
export default function PreviewButton({ outDir }: Props) {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: outDir }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start preview");
      setUrl(data.url);
      window.open(data.url, "_blank", "noopener");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={open}
        disabled={loading}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
      >
        {loading ? "Starting…" : url ? "Reopen Preview" : "▶ Open Preview"}
      </button>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-2 font-mono text-xs text-indigo-300 hover:underline"
        >
          {url}
        </a>
      )}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
