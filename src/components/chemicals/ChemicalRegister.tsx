"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHEMICAL_STATUSES,
  CLASSIFICATIONS,
  HAZARD_TYPES,
  SDS_STATE_LABELS,
  SDS_STATE_STYLES,
  isDangerousGood,
  isHazardous,
  nzDate,
  sdsState,
  type Chemical,
  type SdsState,
} from "@/lib/chemicals-shared";

type StatusFilter = "approved" | "draft" | "retired" | "all";
const STATUS_TABS: { id: StatusFilter; label: string; match: (c: Chemical) => boolean }[] = [
  { id: "approved", label: "Approved for use", match: (c) => c.status === "Approved for Use" },
  { id: "draft", label: "Draft", match: (c) => c.status === "Draft" },
  { id: "retired", label: "No longer in use", match: (c) => c.status === "No Longer in Use" },
  { id: "all", label: "All", match: () => true },
];

const HAZARD_SHORT: Record<string, { label: string; cls: string }> = {
  "Health hazards": { label: "Health", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  "Physical hazards": { label: "Physical", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  "Environmental hazards": { label: "Enviro", cls: "bg-teal-50 text-teal-700 border-teal-200" },
};

export function SdsBadge({ chemical }: { chemical: Chemical }) {
  const s = sdsState(chemical);
  return <span className={`text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap ${SDS_STATE_STYLES[s]}`}>{SDS_STATE_LABELS[s]}</span>;
}

export function HazardChips({ hazards }: { hazards: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {hazards.map((h) => {
        const m = HAZARD_SHORT[h] ?? { label: h, cls: "bg-slate-50 text-slate-600 border-slate-200" };
        return (
          <span key={h} className={`text-[11px] px-1.5 py-0.5 rounded border ${m.cls}`}>
            {m.label}
          </span>
        );
      })}
    </span>
  );
}

export default function ChemicalRegister({ canEdit }: { canEdit: boolean }) {
  const [chemicals, setChemicals] = useState<Chemical[] | null>(null);
  const [status, setStatus] = useState<StatusFilter>("approved");
  const [search, setSearch] = useState("");
  const [cls, setCls] = useState<"all" | "hazardous" | "dg" | "none">("all");
  const [sds, setSds] = useState<"all" | SdsState>("all");
  const [editing, setEditing] = useState<Chemical | "new" | null>(null);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch("/api/chemicals");
    const data = await res.json();
    setChemicals(data.chemicals || []);
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    void load();
  }, []);

  const inStatus = useMemo(() => (chemicals || []).filter(STATUS_TABS.find((t) => t.id === status)!.match), [chemicals, status]);

  const stats = useMemo(() => {
    const approved = (chemicals || []).filter((c) => c.status === "Approved for Use");
    const states = approved.map((c) => sdsState(c));
    return {
      approved: approved.length,
      hazardous: approved.filter(isHazardous).length,
      dg: approved.filter(isDangerousGood).length,
      expired: states.filter((s) => s === "expired").length,
      expiring: states.filter((s) => s === "expiring").length,
    };
  }, [chemicals]);

  const rows = useMemo(() => {
    let r = inStatus;
    if (cls === "hazardous") r = r.filter(isHazardous);
    if (cls === "dg") r = r.filter(isDangerousGood);
    if (cls === "none") r = r.filter((c) => !isHazardous(c));
    if (sds !== "all") r = r.filter((c) => sdsState(c) === sds);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((c) => [c.id, c.productName, c.unNumber, c.sdsFilename].some((v) => v.toLowerCase().includes(q)));
    return r;
  }, [inStatus, cls, sds, search]);

  async function importCsv(file: File) {
    setImporting(true);
    setImportMsg(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/chemicals/import", { method: "POST", body: form });
    const data = await res.json();
    setImporting(false);
    if (!res.ok) return setImportMsg({ ok: false, text: data.error || "Import failed" });
    const r = data.result;
    setImportMsg({
      ok: true,
      text: `Imported ${r.total} rows from Donesafe: ${r.created} new, ${r.updated} updated, ${r.unchanged} unchanged${r.linked ? `, ${r.linked} draft entr${r.linked === 1 ? "y" : "ies"} matched to their Donesafe record` : ""}${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}.`,
    });
    void load();
  }

  const tile = (label: string, value: number, onClick?: () => void, tone = "") => (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`text-left rounded-xl border border-border bg-card px-4 py-3 ${onClick ? "hover:bg-neutral-50" : ""}`}
    >
      <p className={`text-2xl font-semibold tracking-tight ${tone}`}>{chemicals ? value : "—"}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </button>
  );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Chemical register</h1>
          <p className="text-sm text-neutral-500">
            Hazardous substances approved for Sansom sites, from Donesafe. Feeds the hazardous substance register in each SSSP.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEdit && (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-60"
                title="Upload the Chemical register CSV exported from Donesafe — matches on Record ID"
              >
                {importing ? "Importing…" : "Import Donesafe CSV"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importCsv(f);
                  e.target.value = "";
                }}
              />
            </>
          )}
          <button onClick={() => setEditing("new")} className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700">
            + Add chemical
          </button>
        </div>
      </div>

      {importMsg && (
        <p className={`text-sm mb-4 rounded-lg border px-3 py-2 ${importMsg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {importMsg.text}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
        {tile("Approved for use", stats.approved, () => {
          setStatus("approved");
          setCls("all");
          setSds("all");
        })}
        {tile("Hazardous substances", stats.hazardous, () => {
          setStatus("approved");
          setCls("hazardous");
        })}
        {tile("Dangerous goods", stats.dg, () => {
          setStatus("approved");
          setCls("dg");
        })}
        {tile("SDS expired", stats.expired, () => {
          setStatus("approved");
          setSds("expired");
        }, stats.expired ? "text-red-600" : "")}
        {tile("SDS expiring ≤ 6 months", stats.expiring, () => {
          setStatus("approved");
          setSds("expiring");
        }, stats.expiring ? "text-amber-600" : "")}
      </div>

      <div className="flex flex-wrap items-center gap-1 mb-3 border-b border-border">
        {STATUS_TABS.map((t) => {
          const n = (chemicals || []).filter(t.match).length;
          return (
            <button
              key={t.id}
              onClick={() => setStatus(t.id)}
              className={`px-3 py-2 text-sm border-b-2 -mb-px transition ${
                status === t.id ? "border-accent text-accent font-medium" : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {t.label}
              {n ? <span className="ml-1.5 text-xs text-neutral-400">{n}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search product, record ID, UN number…"
          className="w-full max-w-sm rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <select value={cls} onChange={(e) => setCls(e.target.value as typeof cls)} className="rounded-lg border border-border px-2 py-2 text-sm bg-white">
          <option value="all">All classifications</option>
          <option value="hazardous">Hazardous / dangerous</option>
          <option value="dg">Dangerous goods</option>
          <option value="none">Not classified</option>
        </select>
        <select value={sds} onChange={(e) => setSds(e.target.value as typeof sds)} className="rounded-lg border border-border px-2 py-2 text-sm bg-white">
          <option value="all">Any SDS status</option>
          <option value="expired">SDS expired</option>
          <option value="expiring">Expiring ≤ 6 months</option>
          <option value="ok">SDS current</option>
          <option value="missing">No SDS</option>
        </select>
        {(cls !== "all" || sds !== "all" || search) && (
          <button onClick={() => { setCls("all"); setSds("all"); setSearch(""); }} className="text-xs text-neutral-500 hover:text-neutral-800 px-2">
            Clear filters
          </button>
        )}
        <span className="ml-auto self-center text-xs text-neutral-400">{rows.length} shown</span>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        {chemicals === null ? (
          <p className="p-6 text-sm text-neutral-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-neutral-500">
            {chemicals.length === 0 ? "The register is empty — import the Donesafe CSV to load it." : "No chemicals match."}
          </p>
        ) : (
          <table className="w-full min-w-[860px]">
            <thead>
              <tr className="text-left text-xs text-neutral-500 border-b border-border">
                <th className="px-3 py-2 font-medium">Record</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">UN</th>
                <th className="px-3 py-2 font-medium">Classification</th>
                <th className="px-3 py-2 font-medium min-w-[190px]">Hazards</th>
                <th className="px-3 py-2 font-medium">SDS date</th>
                <th className="px-3 py-2 font-medium">SDS expiry</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} onClick={() => setEditing(c)} className="cursor-pointer hover:bg-neutral-50 border-b border-border last:border-0">
                  <td className="px-3 py-2.5 mono-id text-neutral-400 whitespace-nowrap">{c.id}</td>
                  <td className="px-3 py-2.5">
                    <p className="text-sm text-neutral-900">{c.productName}</p>
                    {c.status !== "Approved for Use" && <p className="text-[11px] text-neutral-400">{c.status}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-neutral-600 whitespace-nowrap">{c.unNumber === "Not Classified" ? "—" : c.unNumber || "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-neutral-600">
                    {isDangerousGood(c) ? <span className="font-medium text-red-700">DG</span> : null}
                    {isDangerousGood(c) && isHazardous(c) && /hazardous/i.test(c.classification) ? " · " : ""}
                    {/hazardous substance/i.test(c.classification) ? "Hazardous" : !isHazardous(c) ? <span className="text-neutral-400">Not classified</span> : ""}
                  </td>
                  <td className="px-3 py-2.5">
                    <HazardChips hazards={c.hazards} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-neutral-600 whitespace-nowrap">{nzDate(c.sdsDate) || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="text-xs text-neutral-600 mr-1.5">{nzDate(c.sdsExpiry)}</span>
                    {sdsState(c) !== "ok" && <SdsBadge chemical={c} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <ChemicalDrawer
          chemical={editing === "new" ? null : editing}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setChemicals((prev) => {
              const list = prev || [];
              return list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c].sort((a, b) => a.productName.localeCompare(b.productName));
            });
            setEditing(c);
          }}
          onDeleted={(id) => {
            setChemicals((prev) => (prev || []).filter((x) => x.id !== id));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ChemicalDrawer({
  chemical,
  canEdit,
  onClose,
  onSaved,
  onDeleted,
}: {
  chemical: Chemical | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (c: Chemical) => void;
  onDeleted: (id: string) => void;
}) {
  const isNew = !chemical;
  const readOnly = !isNew && !canEdit;
  const [form, setForm] = useState({
    productName: chemical?.productName ?? "",
    status: chemical?.status ?? "Draft",
    unNumber: chemical?.unNumber ?? "",
    classification: chemical?.classification ?? "Hazardous substance",
    hazards: chemical?.hazards ?? [],
    location: chemical?.location ?? "Auckland",
    sdsFilename: chemical?.sdsFilename ?? "",
    sdsDate: chemical?.sdsDate ?? "",
    sdsExpiry: chemical?.sdsExpiry ?? "",
    notes: chemical?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sdsRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(isNew ? "/api/chemicals" : `/api/chemicals/${chemical!.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, sdsDate: form.sdsDate || null, sdsExpiry: form.sdsExpiry || null }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error || "Couldn't save");
    onSaved(data.chemical);
  }

  async function uploadSds(file: File) {
    if (!chemical) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/chemicals/${chemical.id}/sds`, { method: "POST", body: fd });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error || "Upload failed");
    onSaved(data.chemical);
  }

  async function remove() {
    if (!chemical || !confirm(`Remove ${chemical.productName} from the register? SSSPs that list it will drop it.`)) return;
    const res = await fetch(`/api/chemicals/${chemical.id}`, { method: "DELETE" });
    if (res.ok) onDeleted(chemical.id);
    else setError((await res.json()).error || "Couldn't remove");
  }

  const input = "w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:bg-neutral-50";
  const label = "block text-xs font-medium text-neutral-500 mb-1";

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-card border-l border-border flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 h-14 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {chemical && <span className="mono-id text-neutral-400">{chemical.id}</span>}
            <span className="font-medium text-sm truncate">{isNew ? "Add chemical" : readOnly ? chemical!.productName : "Edit chemical"}</span>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 text-lg leading-none">✕</button>
        </div>

        <fieldset disabled={readOnly || busy} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isNew && (
            <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2">
              New chemicals are added as <b>Draft</b>. Add it in Donesafe too — the next Donesafe import links this entry to its Donesafe record by product name.
            </p>
          )}
          <div>
            <label className={label}>Product name</label>
            <input value={form.productName} onChange={(e) => set("productName", e.target.value)} className={input} placeholder="e.g. Sikadur-31 CF Rapid Part A" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Status</label>
              <select value={form.status} onChange={(e) => set("status", e.target.value)} className={input} disabled={isNew || readOnly}>
                {CHEMICAL_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>UN number</label>
              <input value={form.unNumber} onChange={(e) => set("unNumber", e.target.value)} className={input} placeholder="UN3082 or Not Classified" />
            </div>
          </div>
          <div>
            <label className={label}>Hazardous or a dangerous good?</label>
            <select value={form.classification} onChange={(e) => set("classification", e.target.value)} className={input}>
              {[...new Set([...CLASSIFICATIONS, form.classification])].filter(Boolean).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Hazard posed by chemical</label>
            <div className="flex flex-wrap gap-1.5">
              {HAZARD_TYPES.map((h) => {
                const on = form.hazards.includes(h);
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => set("hazards", on ? form.hazards.filter((x) => x !== h) : [...form.hazards, h])}
                    className={`rounded-full border px-3 py-1 text-xs ${on ? "border-accent bg-accent text-white" : "border-border bg-white text-neutral-600 hover:bg-neutral-50"}`}
                  >
                    {on ? "✓ " : ""}
                    {h}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>SDS revision date</label>
              <input type="date" value={form.sdsDate} onChange={(e) => set("sdsDate", e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>SDS expiry</label>
              <input type="date" value={form.sdsExpiry} onChange={(e) => set("sdsExpiry", e.target.value)} className={input} />
              <p className="text-[11px] text-neutral-400 mt-0.5">Blank = 5 years from the revision date</p>
            </div>
          </div>
          <div>
            <label className={label}>Location</label>
            <input value={form.location} onChange={(e) => set("location", e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Notes</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className={input} />
          </div>

          {chemical && (
            <div className="rounded-xl border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-500">Safety data sheet</span>
                <SdsBadge chemical={chemical} />
              </div>
              {chemical.sdsFilename && <p className="text-xs text-neutral-600 break-words">Donesafe: {chemical.sdsFilename}</p>}
              <div className="flex flex-wrap gap-2">
                {chemical.hasSdsFile && (
                  <a href={`/api/chemicals/${chemical.id}/sds`} target="_blank" rel="noreferrer" className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-neutral-50">
                    Open SDS PDF
                  </a>
                )}
                {canEdit && (
                  <>
                    <button type="button" onClick={() => sdsRef.current?.click()} className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-neutral-50">
                      {chemical.hasSdsFile ? "Replace SDS PDF" : "Upload SDS PDF"}
                    </button>
                    <input
                      ref={sdsRef}
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadSds(f);
                        e.target.value = "";
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          )}
          {chemical?.source === "donesafe" && canEdit && (
            <p className="text-[11px] text-neutral-400">Imported from Donesafe — a later Donesafe import will overwrite edits to these fields (notes and the uploaded SDS are kept).</p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </fieldset>

        {!readOnly && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border">
            {chemical && canEdit ? (
              <button onClick={remove} className="text-xs text-neutral-400 hover:text-red-600">Remove from register</button>
            ) : (
              <span />
            )}
            <button onClick={save} disabled={busy || !form.productName.trim()} className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
              {busy ? "Saving…" : isNew ? "Add as draft" : "Save"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
