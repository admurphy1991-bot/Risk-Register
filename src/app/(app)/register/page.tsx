"use client";

import { useEffect, useMemo, useState } from "react";
import type { Risk } from "@/lib/types";
import { scoreLevel, LEVEL_COLORS, STATUS_COLORS, categoryColor } from "@/lib/risk-scoring";
import RiskDrawer from "@/components/RiskDrawer";

type Meta = { categories: { id: string; name: string }[]; locations: { id: string; name: string }[] };
type View = "all" | "category" | "location" | "high" | "review";

const VIEWS: { id: View; label: string }[] = [
  { id: "all", label: "Risk register" },
  { id: "category", label: "By category" },
  { id: "location", label: "By location" },
  { id: "high", label: "High and critical" },
  { id: "review", label: "Review due" },
];

export default function RegisterPage() {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [meta, setMeta] = useState<Meta>({ categories: [], locations: [] });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Risk | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [risksRes, metaRes] = await Promise.all([fetch("/api/risks"), fetch("/api/meta")]);
    const risksData = await risksRes.json();
    const metaData = await metaRes.json();
    setRisks(risksData.risks || []);
    setMeta(metaData);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, []);

  const filtered = useMemo(() => {
    let rows = risks;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) => r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || r.ownerName.toLowerCase().includes(q)
      );
    }
    if (view === "high") {
      rows = rows.filter((r) => {
        const level = scoreLevel(r.residualScore ?? r.inherentScore ?? null);
        return level === "High" || level === "Critical";
      });
    }
    if (view === "review") {
      const now = new Date();
      const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      rows = rows.filter((r) => r.nextReviewDate && new Date(r.nextReviewDate) <= in30);
    }
    return rows;
  }, [risks, search, view]);

  const grouped = useMemo(() => {
    if (view !== "category" && view !== "location") return null;
    const key = view === "category" ? "category" : "location";
    const groups: Record<string, Risk[]> = {};
    for (const r of filtered) {
      const k = (r[key] as string) || "(unassigned)";
      (groups[k] ||= []).push(r);
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filtered, view]);

  async function handleImport(file: File) {
    setImporting(true);
    setImportMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import/csv", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportMsg(`Imported ${data.imported} risk(s).`);
      load();
    } catch (err) {
      setImportMsg((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  function Row({ r }: { r: Risk }) {
    const level = scoreLevel(r.residualScore ?? r.inherentScore ?? null);
    return (
      <tr onClick={() => setEditing(r)} className="cursor-pointer hover:bg-neutral-50 border-b border-border last:border-0">
        <td className="px-3 py-2.5 mono-id text-neutral-400 whitespace-nowrap">{r.id}</td>
        <td className="px-3 py-2.5">
          <p className="text-sm text-neutral-900">{r.title || <span className="text-neutral-400 italic">Add risk</span>}</p>
          {r.ownerName && <p className="text-xs text-neutral-400">{r.ownerName}</p>}
        </td>
        <td className="px-3 py-2.5">
          {r.category && (
            <span className={`text-xs px-1.5 py-0.5 rounded border ${categoryColor(r.category)}`}>{r.category}</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-sm text-neutral-600 whitespace-nowrap">{r.location}</td>
        <td className="px-3 py-2.5 text-sm text-neutral-600 text-center">{r.inherentScore ?? "—"}</td>
        <td className="px-3 py-2.5 text-sm text-center">
          <span className={level ? `px-1.5 py-0.5 rounded border text-xs font-medium ${LEVEL_COLORS[level]}` : "text-neutral-400"}>
            {r.residualScore ?? "—"}
          </span>
        </td>
        <td className="px-3 py-2.5 text-sm text-neutral-500 whitespace-nowrap">{r.nextReviewDate ?? "—"}</td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          <span className={`text-xs px-1.5 py-0.5 rounded border ${STATUS_COLORS[r.status] || "bg-neutral-100 text-neutral-600 border-neutral-200"}`}>
            {r.status}
          </span>
        </td>
      </tr>
    );
  }

  const headerRow = (
    <tr className="text-left text-xs text-neutral-500 border-b border-border">
      <th className="px-3 py-2 font-medium">ID</th>
      <th className="px-3 py-2 font-medium">Risk</th>
      <th className="px-3 py-2 font-medium">Category</th>
      <th className="px-3 py-2 font-medium">Location</th>
      <th className="px-3 py-2 font-medium text-center">Inherent</th>
      <th className="px-3 py-2 font-medium text-center">Residual</th>
      <th className="px-3 py-2 font-medium">Next review</th>
      <th className="px-3 py-2 font-medium">Status</th>
    </tr>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Risk register</h1>
          <p className="text-sm text-neutral-500">{filtered.length} record{filtered.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-neutral-50 cursor-pointer">
            {importing ? "Importing…" : "Import CSV"}
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])}
            />
          </label>
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-accent text-white px-3.5 py-2 text-sm font-medium hover:bg-indigo-700"
          >
            + Add risk
          </button>
        </div>
      </div>

      {importMsg && <p className="text-sm text-accent mb-3">{importMsg}</p>}

      <div className="flex items-center gap-1 mb-3 border-b border-border">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px transition ${
              view === v.id ? "border-accent text-accent font-medium" : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search risks…"
        className="w-full max-w-sm rounded-lg border border-border px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-accent/40"
      />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-neutral-400">Loading…</p>
        ) : grouped ? (
          <div className="divide-y divide-border">
            {grouped.map(([name, rows]) => (
              <div key={name}>
                <div className="px-3 py-2 bg-neutral-50 text-xs font-medium text-neutral-600">
                  {name} · {rows.length}
                </div>
                <table className="w-full">
                  <tbody>
                    {rows.map((r) => (
                      <Row key={r.id} r={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {grouped.length === 0 && <p className="p-6 text-sm text-neutral-400">No risks match.</p>}
          </div>
        ) : (
          <table className="w-full">
            <thead>{headerRow}</thead>
            <tbody>
              {filtered.map((r) => (
                <Row key={r.id} r={r} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-sm text-neutral-400 text-center">
                    No risks match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {(editing || creating) && (
        <RiskDrawer
          risk={editing}
          meta={meta}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            load();
          }}
          onDeleted={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
