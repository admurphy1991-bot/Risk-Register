"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { TaStatus } from "@/lib/ta-shared";
import { LEVEL_COLORS, ratingLabel, scoreLevel } from "@/lib/risk-scoring";
import { TaStatusBadge } from "@/components/ta/TaStatusBadge";

type TaRow = {
  id: string;
  jobNumber: string;
  projectName: string;
  siteAddress: string;
  taDate: string | null;
  status: TaStatus;
  preparedByName: string;
  updatedAt: string;
  submittedAt: string | null;
  stepCount: number;
  riskCount: number;
  maxInitialScore: number | null;
  maxResidualScore: number | null;
};

const FILTERS: { id: "all" | TaStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "submitted", label: "Awaiting review" },
  { id: "changes_requested", label: "Changes requested" },
  { id: "approved", label: "Approved" },
  { id: "closed", label: "Closed" },
];

export default function TaListPage() {
  const router = useRouter();
  const [tas, setTas] = useState<TaRow[] | null>(null);
  const [filter, setFilter] = useState<"all" | TaStatus>("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tas")
      .then((r) => r.json())
      .then((d) => setTas(d.tas || []))
      .catch(() => setError("Couldn't load task analyses."));
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tas?.length ?? 0 };
    for (const t of tas || []) c[t.status] = (c[t.status] || 0) + 1;
    return c;
  }, [tas]);

  const rows = useMemo(() => {
    let r = tas || [];
    if (filter !== "all") r = r.filter((t) => t.status === filter);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((t) => [t.id, t.jobNumber, t.projectName, t.siteAddress, t.preparedByName].some((v) => v?.toLowerCase().includes(q)));
    return r;
  }, [tas, filter, search]);

  async function createTa() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/tas", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't create TA");
      router.push(`/tas/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Task analyses</h1>
          <p className="text-sm text-neutral-500">
            TA / SWMS for each job — built from the Sansom risk register, reviewed by H&amp;S, filed to M-Files.
          </p>
        </div>
        <button
          onClick={createTa}
          disabled={creating}
          className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 shrink-0"
        >
          {creating ? "Creating…" : "+ Create TA"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {!!counts.submitted && (
        <button
          onClick={() => setFilter("submitted")}
          className="w-full text-left mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
        >
          <span className="font-medium">{counts.submitted} TA{counts.submitted === 1 ? "" : "s"} awaiting H&amp;S review</span>
          <span className="text-amber-700"> — show them →</span>
        </button>
      )}

      <div className="flex flex-wrap items-center gap-1 mb-3 border-b border-border">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px transition ${
              filter === f.id ? "border-accent text-accent font-medium" : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
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
        {tas === null ? (
          <p className="p-6 text-sm text-neutral-400">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-neutral-500 mb-3">
              {tas.length === 0 ? "No task analyses yet." : "No task analyses match."}
            </p>
            {tas.length === 0 && (
              <button onClick={createTa} className="text-sm text-accent font-medium hover:underline">
                Create the first one →
              </button>
            )}
          </div>
        ) : (
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="text-left text-xs text-neutral-500 border-b border-border">
                <th className="px-3 py-2 font-medium">TA</th>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Prepared by</th>
                <th className="px-3 py-2 font-medium text-center">Steps</th>
                <th className="px-3 py-2 font-medium text-center">Highest residual</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const level = scoreLevel(t.maxResidualScore);
                return (
                  <tr key={t.id} onClick={() => router.push(`/tas/${t.id}`)} className="cursor-pointer hover:bg-neutral-50 border-b border-border last:border-0">
                    <td className="px-3 py-2.5 mono-id text-neutral-400 whitespace-nowrap">
                      <Link href={`/tas/${t.id}`} onClick={(e) => e.stopPropagation()}>
                        {t.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-sm text-neutral-900">
                        {t.jobNumber && <span className="font-medium mr-1.5">{t.jobNumber}</span>}
                        {t.projectName || <span className="text-neutral-400 italic">Untitled draft</span>}
                      </p>
                      {t.siteAddress && <p className="text-xs text-neutral-400">{t.siteAddress}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-neutral-600 whitespace-nowrap">{t.preparedByName}</td>
                    <td className="px-3 py-2.5 text-sm text-neutral-600 text-center">{t.stepCount}</td>
                    <td className="px-3 py-2.5 text-center">
                      {level ? (
                        <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${LEVEL_COLORS[level]}`}>{ratingLabel(t.maxResidualScore)}</span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <TaStatusBadge status={t.status} />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-neutral-500 whitespace-nowrap">{new Date(t.updatedAt).toLocaleDateString("en-NZ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
