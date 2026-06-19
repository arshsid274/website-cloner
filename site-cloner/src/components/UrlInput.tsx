"use client";

import { useState } from "react";

interface Props {
  onScan: (url: string) => void;
  loading: boolean;
}

export default function UrlInput({ onScan, loading }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const url = value.trim();
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error();
      }
    } catch {
      setError("Enter a valid http(s) URL, e.g. https://example.com");
      return;
    }
    setError(null);
    onScan(url);
  }

  return (
    <form onSubmit={submit} className="w-full">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          inputMode="url"
          placeholder="https://www.example.com/"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900/80 px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Scanning…" : "Scan"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </form>
  );
}
