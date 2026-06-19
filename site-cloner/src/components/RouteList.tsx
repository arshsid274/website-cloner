"use client";

import { useState } from "react";

interface Props {
  routes: string[];
  selected: Set<string>;
  onToggle: (route: string) => void;
  onAdd: (route: string) => void;
  onSelectAll: (all: boolean) => void;
}

export default function RouteList({
  routes,
  selected,
  onToggle,
  onAdd,
  onSelectAll,
}: Props) {
  const [draft, setDraft] = useState("");

  function add(e: React.FormEvent) {
    e.preventDefault();
    let r = draft.trim();
    if (!r) return;
    if (!r.startsWith("/")) r = "/" + r;
    onAdd(r);
    setDraft("");
  }

  const allSelected = routes.length > 0 && selected.size === routes.length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-300">
          Routes{" "}
          <span className="text-neutral-500">
            ({selected.size}/{routes.length})
          </span>
        </h3>
        <button
          onClick={() => onSelectAll(!allSelected)}
          className="text-xs text-indigo-400 hover:text-indigo-300"
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>

      <div className="scroll-thin max-h-56 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900/50">
        {routes.map((r) => (
          <label
            key={r}
            className="flex cursor-pointer items-center gap-3 border-b border-neutral-800/60 px-3 py-2 text-sm last:border-0 hover:bg-neutral-800/40"
          >
            <input
              type="checkbox"
              checked={selected.has(r)}
              onChange={() => onToggle(r)}
              className="h-4 w-4 accent-indigo-500"
            />
            <span className="truncate font-mono text-neutral-300">{r}</span>
          </label>
        ))}
        {routes.length === 0 && (
          <p className="px-3 py-4 text-sm text-neutral-500">No routes found.</p>
        )}
      </div>

      <form onSubmit={add} className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="/add-a-route"
          className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900/80 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
        >
          Add
        </button>
      </form>
    </div>
  );
}
