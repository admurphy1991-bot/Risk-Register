"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Risk } from "@/lib/types";
import { RatingBadge } from "@/components/ta/RatingPicker";

const GROUPS = [
  { key: "Tactical", label: "Site / tactical" },
  { key: "Procedural", label: "Procedural" },
  { key: "Strategic", label: "Strategic / business" },
];

/** Modal for linking Sansom register risks to a job step. */
export function RiskPicker({
  register,
  selected,
  onToggle,
  onClose,
  stepLabel,
}: {
  register: Risk[];
  selected: string[];
  onToggle: (riskId: string) => void;
  onClose: () => void;
  stepLabel: string;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const grouped = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matches = register.filter(
      (r) =>
        r.status !== "Closed" &&
        (!needle ||
          r.id.toLowerCase().includes(needle) ||
          r.title.toLowerCase().includes(needle) ||
          r.category.toLowerCase().includes(needle) ||
          r.description.toLowerCase().includes(needle))
    );
    const byGroup = GROUPS.map((g) => ({
      ...g,
      risks: matches
        .filter((r) => (r.location || "").startsWith(g.key))
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
    }));
    const other = matches.filter((r) => !GROUPS.some((g) => (r.location || "").startsWith(g.key)));
    if (other.length) byGroup.push({ key: "Other", label: "Other", risks: other });
    return byGroup.filter((g) => g.risks.length);
  }, [register, q]);

  const selectedSet = new Set(selected);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center p-4 sm:pt-16">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[80vh] flex flex-col bg-card border border-border rounded-xl shadow-2xl">
        <div className="px-4 pt-4 pb-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-medium">Link register risks</p>
              <p className="text-xs text-neutral-500 truncate max-w-md">{stepLabel}</p>
            </div>
            <button onClick={onClose} className="rounded-md bg-accent text-white text-xs font-medium px-3 py-1.5 hover:bg-indigo-700">
              Done ({selected.length})
            </button>
          </div>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search risks — e.g. height, MEWP, chemical, TAC-16…"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
        <div className="overflow-y-auto px-2 py-2">
          {grouped.length === 0 && <p className="p-4 text-sm text-neutral-400">No risks match “{q}”.</p>}
          {grouped.map((g) => (
            <div key={g.key} className="mb-2">
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{g.label}</p>
              {g.risks.map((r) => {
                const on = selectedSet.has(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => onToggle(r.id)}
                    className={`w-full text-left flex items-start gap-3 rounded-lg px-2 py-2 transition ${on ? "bg-accent-soft" : "hover:bg-neutral-50"}`}
                  >
                    <span
                      className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${
                        on ? "bg-accent border-accent text-white" : "border-neutral-300"
                      }`}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="mono-id text-neutral-400">{r.id}</span>
                        <span className="text-sm text-neutral-900 truncate">{r.title}</span>
                      </span>
                      {r.description && <span className="text-xs text-neutral-500 line-clamp-1">{r.description}</span>}
                    </span>
                    <span className="flex flex-col items-end gap-1 shrink-0">
                      <RatingBadge score={r.residualScore ?? r.inherentScore} />
                      <span className="text-[10px] text-neutral-400">{r.category}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
