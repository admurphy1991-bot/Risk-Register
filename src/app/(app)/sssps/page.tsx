"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { TaStatus } from "@/lib/ta-shared";
import { TaStatusBadge } from "@/components/ta/TaStatusBadge";

type Row = {
  id: string;
  jobNumber: string;
  projectName: string;
  siteAddress: string;
  mainContractor: string;
  status: TaStatus;
  preparedByName: string;
  updatedAt: string;
  riskCount: number;
  chemicalCount: number;
  taIds: string[];
  startDate: string | null;
};
type TaOption = { id: string; jobNumber: string; projectName: string; status: TaStatus };

const FILTERS: { id: "all" | TaStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "submitted", label: "Awaiting review" },
  { id: "changes_requested", label: "Changes requested" },
  { id: "approved", label: "Approved" },
  { id: "closed", label: "Closed" },
];

export default function SsspListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tas, setTas] = useState<TaOption[]>([]);
  const [filter, setFilter] = useState<"all" | TaStatus>("all");
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState(false);
  const [fromTa, setFromTa] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetch("/api/sssps").then((r) => r.json()), fetch("/api/tas").then((r) => r.json())])
      .then(([s, t]) => {
        setRows(s.sssps || []);
        setTas(t.tas || []);
      })
      .catch(() => setError("Couldn't load SSSPs."));
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows?.length ?? 0 };
    for (const r of rows || []) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    let r = rows || [];
    if (filter !== "all") r = r.filter((x) => x.status === filter);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((x) => [x.id, x.jobNumber, x.projectName, x.siteAddress, x.mainContractor, x.preparedByName].some((v) => v?.toLowerCase().includes(q)));
    return r;
  }, [rows, filter, search]);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/sssps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fromTa ? { fromTaId: fromTa } : {}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't create SSSP");
      router.push(`/sssps/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Site Specific Safety Plans</h1>
          <p className="text-sm text-neutral-500">
            SSSPs built on Sansom&apos;s master template — drafted by AI from the proposal and the job&apos;s TA, reviewed by H&amp;S.
          </p>
        </div>
        <button onClick={() => setPicking(true)} className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 shrink-0">
          + New SSSP
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {picking && (
        <div className="mb-5 rounded-xl border border-accent/30 bg-accent-soft/50 p-4">
          <p className="text-sm font-medium mb-1">Start a new SSSP</p>
          <p className="text-xs text-neutral-600 mb-3">
            Starting from the job&apos;s task analysis copies the project details, site risks and chemicals across — the AI then fills in the rest.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <select value={fromTa} onChange={(e) => setFromTa(e.target.value)} className="rounded-lg border border-border px-3 py-2 text-sm bg-white min-w-[280px] max-w-full">
              <option value="">Blank — I&apos;ll upload the proposal</option>
              {tas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} · {[t.jobNumber, t.projectName].filter(Boolean).join(" ") || "Untitled"} ({t.status.replace("_", " ")})
                </option>
              ))}
            </select>
            <button onClick={create} disabled={creating} className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
              {creating ? "Creating…" : "Create"}
            </button>
            <button onClick={() => setPicking(false)} className="text-sm text-neutral-500 hover:text-neutral-800 px-2">Cancel</button>
          </div>
        </div>
      )}

      {!!counts.submitted && (
        <button onClick={() => setFilter("submitted")} className="w-full text-left mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
          <span className="font-medium">{counts.submitted} SSSP{counts.submitted === 1 ? "" : "s"} awaiting H&amp;S review</span>
          <span className="text-amber-700"> — show them →</span>
        </button>
      )}

      <div className="flex flex-wrap items-center gap-1 mb-3 border-b border-border">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px transition ${filter === f.id ? "border-accent text-accent font-medium" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
          >
            {f.label}
            {counts[f.id] ? <span className="ml-1.5 text-xs text-neutral-400">{counts[f.id]}</span> : null}
          </button>
        ))}
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search job number, project, site…"
        className="w-full max-w-sm rounded-lg border border-border px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-accent/40"
      />

      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        {rows === null ? (
          <p className="p-6 text-sm text-neutral-400">Loading…</p>
        ) : shown.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-neutral-500 mb-3">{rows.length === 0 ? "No SSSPs yet." : "No SSSPs match."}</p>
            {rows.length === 0 && (
              <button onClick={() => setPicking(true)} className="text-sm text-accent font-medium hover:underline">Create the first one →</button>
            )}
          </div>
        ) : (
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="text-left text-xs text-neutral-500 border-b border-border">
                <th className="px-3 py-2 font-medium">SSSP</th>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Prepared by</th>
                <th className="px-3 py-2 font-medium text-center">Site risks</th>
                <th className="px-3 py-2 font-medium text-center">Substances</th>
                <th className="px-3 py-2 font-medium">TAs</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} onClick={() => router.push(`/sssps/${s.id}`)} className="cursor-pointer hover:bg-neutral-50 border-b border-border last:border-0">
                  <td className="px-3 py-2.5 mono-id text-neutral-400 whitespace-nowrap">
                    <Link href={`/sssps/${s.id}`} onClick={(e) => e.stopPropagation()}>{s.id}</Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-sm text-neutral-900">
                      {s.jobNumber && <span className="font-medium mr-1.5">{s.jobNumber}</span>}
                      {s.projectName || <span className="text-neutral-400 italic">Untitled draft</span>}
                    </p>
                    {s.siteAddress && <p className="text-xs text-neutral-400">{s.siteAddress}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-neutral-600 whitespace-nowrap">{s.preparedByName}</td>
                  <td className="px-3 py-2.5 text-sm text-neutral-600 text-center">{s.riskCount}</td>
                  <td className="px-3 py-2.5 text-sm text-neutral-600 text-center">{s.chemicalCount}</td>
                  <td className="px-3 py-2.5 text-xs text-neutral-500 mono-id">{s.taIds.join(", ") || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap"><TaStatusBadge status={s.status} /></td>
                  <td className="px-3 py-2.5 text-xs text-neutral-500 whitespace-nowrap">{new Date(s.updatedAt).toLocaleDateString("en-NZ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
