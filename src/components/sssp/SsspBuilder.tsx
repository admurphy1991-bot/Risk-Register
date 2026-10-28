"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Risk } from "@/lib/types";
import { EDITABLE_TA_STATUSES, TA_STATUS_LABELS, type TaStatus } from "@/lib/ta-shared";
import {
  NOTIFIABLE_WORKS,
  OPTION_LABELS,
  QUESTIONS,
  QUESTION_GROUPS,
  SSSP_EVENT_LABELS,
  WORK_TYPES,
  ssspProblems,
  type AnswerOption,
  type SsspData,
  type SsspFull,
  type SsspPatch,
} from "@/lib/sssp-shared";
import { sdsState, type Chemical } from "@/lib/chemicals-shared";
import { canReviewRole } from "@/lib/roles";
import { LEVEL_COLORS, ratingLabel, scoreLevel } from "@/lib/risk-scoring";
import { TaStatusBadge } from "@/components/ta/TaStatusBadge";
import { HazardChips, SdsBadge } from "@/components/chemicals/ChemicalRegister";

type Tab = "sources" | "project" | "safety" | "risks" | "substances" | "emergency" | "review";
type SaveState = "idle" | "saving" | "saved" | "error";
type TaOption = { id: string; jobNumber: string; projectName: string; status: TaStatus };
type BuildResult = { filled: string[]; kept: { key: string; label: string; value: unknown }[]; notes: string | null };

const TABS: { id: Tab; label: string }[] = [
  { id: "sources", label: "Sources & AI" },
  { id: "project", label: "Project" },
  { id: "safety", label: "Site safety" },
  { id: "risks", label: "Site risks" },
  { id: "substances", label: "Substances" },
  { id: "emergency", label: "Emergency" },
  { id: "review", label: "Review & submit" },
];

const ACCEPT = ".pdf,.docx,.txt,.md,.csv,.eml,.png,.jpg,.jpeg,.webp";
const NESTED = ["answers", "controls", "emergency", "contacts"] as const;

function mergePatch(a: SsspPatch, b: SsspPatch): SsspPatch {
  const out: SsspPatch = { ...a, ...b, data: { ...(a.data || {}) } };
  for (const [k, v] of Object.entries(b.data || {})) {
    const key = k as keyof SsspData;
    if ((NESTED as readonly string[]).includes(k)) {
      (out.data as Record<string, unknown>)[k] = { ...((a.data?.[key] as object) || {}), ...(v as object) };
    } else (out.data as Record<string, unknown>)[k] = v;
  }
  return out;
}

function applyLocal(s: SsspFull, p: SsspPatch): SsspFull {
  const next: SsspFull = { ...s, ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== "data")), data: { ...s.data } };
  for (const [k, v] of Object.entries(p.data || {})) {
    if ((NESTED as readonly string[]).includes(k)) (next.data as Record<string, unknown>)[k] = { ...(s.data[k as keyof SsspData] as object), ...(v as object) };
    else (next.data as Record<string, unknown>)[k] = v;
  }
  return next;
}

export default function SsspBuilder({ ssspId, user }: { ssspId: string; user: { id: string; name: string; role: string } }) {
  const router = useRouter();
  const [s, setS] = useState<SsspFull | null>(null);
  const [register, setRegister] = useState<Risk[]>([]);
  const [chemicals, setChemicals] = useState<Chemical[]>([]);
  const [tas, setTas] = useState<TaOption[]>([]);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [tab, setTab] = useState<Tab>("sources");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [building, setBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  // --- Autosave --------------------------------------------------------------
  const pending = useRef<SsspPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) await inFlight.current;
    const patch = pending.current;
    if (!Object.keys(patch).length) return true;
    pending.current = {};
    setSaveState("saving");
    const work = (async () => {
      try {
        const res = await fetch(`/api/sssps/${ssspId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setS((prev) => (prev ? { ...prev, aiFilledFields: data.sssp.aiFilledFields, updatedAt: data.sssp.updatedAt, events: data.sssp.events } : prev));
        setSaveState("saved");
        return true;
      } catch {
        pending.current = mergePatch(patch, pending.current);
        setSaveState("error");
        return false;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = work;
    return work;
  }, [ssspId]);

  const patch = useCallback(
    (p: SsspPatch) => {
      setS((prev) => (prev ? applyLocal(prev, p) : prev));
      pending.current = mergePatch(pending.current, p);
      if (timer.current) clearTimeout(timer.current);
      setSaveState("saving");
      timer.current = setTimeout(() => void flush(), 700);
    },
    [flush]
  );
  const patchData = useCallback((data: Partial<SsspData>) => patch({ data }), [patch]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (timer.current || inFlight.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [flush]);

  // --- Load --------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sRes, rRes, cRes, tRes, setRes] = await Promise.all([
          fetch(`/api/sssps/${ssspId}`),
          fetch("/api/risks"),
          fetch("/api/chemicals"),
          fetch("/api/tas"),
          fetch("/api/settings/ta-workflow"),
        ]);
        const sData = await sRes.json();
        if (!sRes.ok) throw new Error(sData.error || "Couldn't load this SSSP");
        const [rData, cData, tData, setData] = await Promise.all([rRes.json(), cRes.json(), tRes.json(), setRes.json()]);
        if (cancelled) return;
        const loaded: SsspFull = sData.sssp;
        setS(loaded);
        setRegister(rData.risks || []);
        setChemicals(cData.chemicals || []);
        setTas(tData.tas || []);
        setAiConfigured(!!setData.aiConfigured);
        setWebhookConfigured(!!setData.settings?.makeWebhookUrl);
        const editable = EDITABLE_TA_STATUSES.includes(loaded.status);
        setTab(!editable ? "review" : loaded.events.some((e) => e.type === "ai_built") ? "project" : "sources");
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ssspId]);

  async function build(instructions: string) {
    setBuilding(true);
    setBuildError(null);
    setBuildResult(null);
    try {
      await flush();
      const res = await fetch(`/api/sssps/${ssspId}/build`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instructions }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The AI couldn't draft the SSSP");
      setS(data.sssp);
      setBuildResult({ filled: data.filled, kept: data.kept, notes: data.notes });
    } catch (err) {
      setBuildError((err as Error).message);
    } finally {
      setBuilding(false);
    }
  }

  if (loadError)
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-red-600 mb-3">{loadError}</p>
        <Link href="/sssps" className="text-sm text-accent hover:underline">← Back to SSSPs</Link>
      </div>
    );
  if (!s) return <p className="py-16 text-center text-sm text-neutral-400">Loading…</p>;

  const editable = EDITABLE_TA_STATUSES.includes(s.status);
  const problems = ssspProblems(s);
  const ai = new Set(s.aiFilledFields);

  async function changeTab(next: Tab) {
    await flush();
    setTab(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteDraft() {
    if (!s || !confirm(`Delete ${s.id}? This can't be undone.`)) return;
    const res = await fetch(`/api/sssps/${s.id}`, { method: "DELETE" });
    if (res.ok) router.push("/sssps");
    else alert((await res.json()).error || "Couldn't delete");
  }

  const tabDone: Record<Tab, boolean> = {
    sources: s.files.length > 0 || s.data.taIds.length > 0,
    project: !!s.projectName && !!s.siteAddress && s.data.workTypes.length > 0,
    safety: QUESTIONS.every((q) => !!s.data.answers[q.id]),
    risks: s.data.riskIds.length > 0,
    substances: s.data.chemicalIds.length > 0 || s.data.answers.hazardous_products === "na",
    emergency: !!s.data.emergency.assemblyPoint && !!s.data.contacts.siteSupervisor && !!s.data.contacts.firstAider,
    review: problems.length === 0,
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <Link href="/sssps" className="text-xs text-neutral-500 hover:text-neutral-800">← SSSPs</Link>
          <h1 className="text-xl font-semibold tracking-tight mt-1 truncate">
            {s.jobNumber && <span className="text-neutral-500 mr-2">{s.jobNumber}</span>}
            {s.projectName || "New site specific safety plan"}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-neutral-500">
            <span className="mono-id">{s.id}</span>
            <TaStatusBadge status={s.status} />
            <span>· prepared by {s.preparedByName}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {editable && (
            <span className={`text-xs ${saveState === "error" ? "text-red-600" : "text-neutral-400"}`}>
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "All changes saved" : saveState === "error" ? "Save failed — retrying on next change" : ""}
            </span>
          )}
          <a href={`/api/sssps/${s.id}/document`} onClick={() => void flush()} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-neutral-50">
            Download Word
          </a>
          {s.status === "draft" && (user.role === "admin" || user.id === s.preparedById) && (
            <button onClick={deleteDraft} className="text-xs text-neutral-400 hover:text-red-600">Delete draft</button>
          )}
        </div>
      </div>

      {editable && (
        <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1">
          {TABS.map((t, i) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => changeTab(t.id)}
                className={`shrink-0 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${active ? "border-accent bg-accent-soft text-accent font-medium" : "border-border bg-card hover:bg-neutral-50 text-neutral-700"}`}
              >
                <span className={`h-5 w-5 rounded-full text-[11px] font-semibold flex items-center justify-center ${tabDone[t.id] ? "bg-emerald-500 text-white" : active ? "bg-accent text-white" : "bg-neutral-100 text-neutral-500"}`}>
                  {tabDone[t.id] ? "✓" : i + 1}
                </span>
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {editable && building && (
        <div className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex items-center gap-3">
          <span className="h-4 w-4 shrink-0 rounded-full border-2 border-indigo-300 border-t-indigo-700 animate-spin" aria-hidden />
          <div>
            <p className="text-sm font-medium text-indigo-950">Drafting the SSSP — reading the documents and TAs, choosing site risks and substances…</p>
            <p className="text-xs text-indigo-900/70">Usually 30–90 seconds. Editing is paused until it&apos;s done.</p>
          </div>
        </div>
      )}
      {editable && buildResult && !building && <BuildBanner result={buildResult} onDismiss={() => setBuildResult(null)} onUse={(key, value) => applyKeptValue(key, value, patch)} />}

      <fieldset disabled={building} className={`min-w-0 ${building ? "opacity-50 pointer-events-none" : ""}`}>
        {editable && tab === "sources" && (
          <SourcesTab s={s} tas={tas} aiConfigured={aiConfigured} building={building} buildError={buildError} onUpdated={setS} patchData={patchData} onBuild={build} onNext={() => changeTab("project")} />
        )}
        {editable && tab === "project" && <ProjectTab s={s} ai={ai} patch={patch} patchData={patchData} onNext={() => changeTab("safety")} />}
        {editable && tab === "safety" && <SafetyTab s={s} ai={ai} patchData={patchData} onNext={() => changeTab("risks")} />}
        {editable && tab === "risks" && <RisksTab s={s} ai={ai} register={register} patchData={patchData} onNext={() => changeTab("substances")} />}
        {editable && tab === "substances" && (
          <SubstancesTab s={s} ai={ai} chemicals={chemicals} setChemicals={setChemicals} patchData={patchData} onNext={() => changeTab("emergency")} />
        )}
        {editable && tab === "emergency" && <EmergencyTab s={s} ai={ai} patchData={patchData} onNext={() => changeTab("review")} />}
      </fieldset>
      {(!editable || tab === "review") && (
        <ReviewTab
          s={s}
          user={user}
          register={register}
          chemicals={chemicals}
          webhookConfigured={webhookConfigured}
          flush={flush}
          onUpdated={(next) => {
            setS(next);
            if (EDITABLE_TA_STATUSES.includes(next.status)) setTab("review");
          }}
          onGoTo={(t) => changeTab(t)}
        />
      )}
    </div>
  );
}

function applyKeptValue(key: string, value: unknown, patch: (p: SsspPatch) => void) {
  if (["jobNumber", "projectName", "siteAddress", "mainContractor"].includes(key)) return patch({ [key]: String(value) });
  const [top, sub] = key.split(".");
  if (sub) return patch({ data: { [top]: { [sub]: value } } as Partial<SsspData> });
  patch({ data: { [top]: value } as Partial<SsspData> });
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const inputCls = "w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40";

function AiBadge({ on }: { on: boolean }) {
  return on ? (
    <span className="rounded bg-indigo-100 text-indigo-700 px-1 text-[10px] font-semibold" title="Drafted by AI — please check">
      ✦ AI
    </span>
  ) : null;
}

function Field({
  label,
  value,
  onChange,
  ai,
  type = "text",
  placeholder,
  area,
  wide,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ai?: boolean;
  type?: string;
  placeholder?: string;
  area?: boolean;
  wide?: boolean;
  hint?: string;
}) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 mb-1">
        {label}
        <AiBadge on={!!ai} />
      </span>
      {area ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} placeholder={placeholder} className={inputCls} />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
      )}
      {hint && <span className="block text-[11px] text-neutral-400 mt-0.5">{hint}</span>}
    </label>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="grid sm:grid-cols-2 gap-4">{children}</div>
    </section>
  );
}

function NextButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="flex justify-end">
      <button onClick={onClick} className="rounded-lg bg-accent text-white text-sm font-medium px-4 py-2 hover:bg-indigo-700">
        {label} →
      </button>
    </div>
  );
}

function BuildBanner({ result, onDismiss, onUse }: { result: BuildResult; onDismiss: () => void; onUse: (key: string, value: unknown) => void }) {
  const [used, setUsed] = useState<string[]>([]);
  const kept = result.kept.filter((k) => !used.includes(k.key));
  return (
    <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">
          {result.filled.length ? "✦ SSSP drafted — everything the AI filled is marked ✦ AI. Please check each tab." : "✦ The AI found nothing new to add."}
        </p>
        <button onClick={onDismiss} className="text-emerald-700/60 hover:text-emerald-900 text-xs shrink-0" aria-label="Dismiss">✕</button>
      </div>
      {result.filled.length > 0 && <p className="text-xs mt-1 text-emerald-900/80">Filled: {result.filled.join(" · ")}</p>}
      {result.notes && (
        <div className="mt-2 rounded-md bg-white/70 border border-emerald-200 px-3 py-2 text-xs text-neutral-800">
          <span className="font-medium">Check before submitting: </span>
          {result.notes}
        </div>
      )}
      {kept.length > 0 && (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs text-emerald-900/80">You&apos;d already filled these in, and the sources suggest something different:</p>
          {kept.map((k) => (
            <div key={k.key} className="flex flex-wrap items-center gap-2 rounded-md bg-white/70 border border-emerald-200 px-2.5 py-1.5 text-xs">
              <span className="font-medium">{k.label}:</span>
              <span className="text-neutral-700 break-words min-w-0 flex-1">“{String(k.value)}”</span>
              <button
                onClick={() => {
                  onUse(k.key, k.value);
                  setUsed((u) => [...u, k.key]);
                }}
                className="rounded border border-emerald-300 px-2 py-0.5 text-emerald-800 hover:bg-emerald-100 shrink-0"
              >
                Use this
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Sources & AI
// ---------------------------------------------------------------------------

function SourcesTab({
  s,
  tas,
  aiConfigured,
  building,
  buildError,
  onUpdated,
  patchData,
  onBuild,
  onNext,
}: {
  s: SsspFull;
  tas: TaOption[];
  aiConfigured: boolean;
  building: boolean;
  buildError: string | null;
  onUpdated: (s: SsspFull) => void;
  patchData: (d: Partial<SsspData>) => void;
  onBuild: (instructions: string) => void;
  onNext: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    setErrors([]);
    try {
      const form = new FormData();
      list.forEach((f) => form.append("files", f));
      const res = await fetch(`/api/sssps/${s.id}/files`, { method: "POST", body: form });
      const data = await res.json();
      if (data.errors?.length) setErrors(data.errors);
      else if (!res.ok) setErrors([data.error || "Upload failed"]);
      if (data.files?.length) onUpdated({ ...s, files: [...s.files, ...data.files] });
    } catch {
      setErrors(["Upload failed — check your connection and try again."]);
    } finally {
      setUploading(false);
    }
  }

  async function remove(fileId: string) {
    const res = await fetch(`/api/sssps/${s.id}/files/${fileId}`, { method: "DELETE" });
    if (res.ok) onUpdated({ ...s, files: s.files.filter((f) => f.id !== fileId) });
  }

  const sameJob = tas.filter((t) => s.jobNumber && t.jobNumber && t.jobNumber.trim().toLowerCase() === s.jobNumber.trim().toLowerCase() && !s.data.taIds.includes(t.id));
  const hasSources = s.files.length > 0 || s.data.taIds.length > 0 || !!s.data.scope.trim();
  const built = s.events.some((e) => e.type === "ai_built");

  return (
    <div className="max-w-3xl space-y-5">
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">1 · Documents for this job</h2>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void upload(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${dragging ? "border-accent bg-accent-soft" : "border-border hover:bg-neutral-50"}`}
        >
          <p className="text-sm font-medium text-neutral-800">{uploading ? "Uploading…" : "Drop the proposal, scope, programme, client emails or site induction pack"}</p>
          <p className="text-xs text-neutral-400 mt-1">PDF · Word (.docx) · email (.eml) · text · images — or click to browse</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {errors.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errors.map((e) => (
              <p key={e}>{e}</p>
            ))}
          </div>
        )}
        {s.files.length > 0 && (
          <div className="rounded-lg border border-border divide-y divide-border">
            {s.files.map((f) => (
              <div key={f.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="truncate">{f.filename}</span>
                <button onClick={() => remove(f.id)} className="text-xs text-neutral-400 hover:text-red-600 shrink-0 ml-3">Remove</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">2 · Task analyses for this job</h2>
        <p className="text-xs text-neutral-500">Linked TAs are read by the AI, listed in the SSSP&apos;s &ldquo;Reviewed Task Analysis&rdquo; section, and their risks carry across.</p>
        {s.data.taIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {s.data.taIds.map((id) => {
              const t = tas.find((x) => x.id === id);
              return (
                <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-accent bg-accent-soft pl-3 pr-1 py-0.5 text-xs text-accent">
                  <Link href={`/tas/${id}`} target="_blank" className="hover:underline">
                    {id}
                    {t ? ` · ${[t.jobNumber, t.projectName].filter(Boolean).join(" ") || "Untitled"}` : ""}
                  </Link>
                  {t && <span className="text-neutral-500">({TA_STATUS_LABELS[t.status]})</span>}
                  <button onClick={() => patchData({ taIds: s.data.taIds.filter((x) => x !== id) })} className="px-1 text-neutral-400 hover:text-red-600" aria-label={`Unlink ${id}`}>
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {sameJob.length > 0 && (
          <p className="text-xs text-indigo-800">
            Same job number:{" "}
            {sameJob.map((t) => (
              <button key={t.id} onClick={() => patchData({ taIds: [...s.data.taIds, t.id], answers: { ta_copies: "yes" } as SsspData["answers"] })} className="underline mr-2">
                + link {t.id}
              </button>
            ))}
          </p>
        )}
        <select
          value=""
          onChange={(e) => e.target.value && patchData({ taIds: [...s.data.taIds, e.target.value] })}
          className="rounded-lg border border-border px-3 py-2 text-sm bg-white w-full max-w-lg"
        >
          <option value="">Link a task analysis…</option>
          {tas
            .filter((t) => !s.data.taIds.includes(t.id))
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} · {[t.jobNumber, t.projectName].filter(Boolean).join(" ") || "Untitled"} ({TA_STATUS_LABELS[t.status]})
              </option>
            ))}
        </select>
      </section>

      <section className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-indigo-950">3 · Build the SSSP with AI</h2>
        <p className="text-xs text-indigo-900/80">
          Drafts the project details, work types, the job-specific YES/N/A answers, dust/noise/runoff controls, notifiable works, the emergency response plan, the site
          risks from the Sansom register and the hazardous substances from the chemical register. It never overwrites anything you&apos;ve typed — run it again after adding documents.
        </p>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={2}
          placeholder="Optional — anything the AI should know, e.g. 'Scaffold is by the main contractor', 'Night works on Level 2 carpark', 'Use Sikadur for crack injection'"
          className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"
        />
        {buildError && <p className="text-sm text-red-700 rounded-lg border border-red-200 bg-red-50 px-3 py-2">{buildError}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => onBuild(instructions)}
            disabled={!aiConfigured || building || !hasSources}
            className="rounded-lg bg-accent text-white text-sm font-medium px-4 py-2 hover:bg-indigo-700 disabled:opacity-50"
          >
            {building ? "Drafting…" : built ? "✦ Re-run AI draft" : "✦ Build SSSP with AI"}
          </button>
          <button onClick={onNext} className="text-sm text-neutral-600 hover:text-neutral-900">
            {built ? "Review the draft →" : "Skip — fill it in manually →"}
          </button>
        </div>
        {!aiConfigured && <p className="text-xs text-amber-700">AI drafting isn&apos;t available — ANTHROPIC_API_KEY isn&apos;t configured on the server.</p>}
        {aiConfigured && !hasSources && <p className="text-xs text-indigo-900/70">Upload a document or link a TA first.</p>}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Project
// ---------------------------------------------------------------------------

function ProjectTab({
  s,
  ai,
  patch,
  patchData,
  onNext,
}: {
  s: SsspFull;
  ai: Set<string>;
  patch: (p: SsspPatch) => void;
  patchData: (d: Partial<SsspData>) => void;
  onNext: () => void;
}) {
  const d = s.data;
  return (
    <div className="max-w-4xl space-y-6">
      <Section title="Project information">
        <Field label="Job number" value={s.jobNumber} ai={ai.has("jobNumber")} onChange={(v) => patch({ jobNumber: v })} placeholder="e.g. S34144" />
        <Field label="SSSP date" type="date" value={d.ssspDate ?? ""} onChange={(v) => patchData({ ssspDate: v || null })} />
        <Field label="Project name" wide value={s.projectName} ai={ai.has("projectName")} onChange={(v) => patch({ projectName: v })} placeholder="e.g. THE GALLERIES 23 GRAHAM ST WATERPROOFING REMEDIATION" />
        <Field label="Project / site location" wide value={s.siteAddress} ai={ai.has("siteAddress")} onChange={(v) => patch({ siteAddress: v })} />
        <Field label="Main contractor / client" value={s.mainContractor} ai={ai.has("mainContractor")} onChange={(v) => patch({ mainContractor: v })} />
        <Field label="Client contact" value={d.clientContactName} ai={ai.has("clientContactName")} onChange={(v) => patchData({ clientContactName: v })} />
        <Field label="Client contact phone" type="tel" value={d.clientContactPhone} ai={ai.has("clientContactPhone")} onChange={(v) => patchData({ clientContactPhone: v })} />
        <span className="hidden sm:block" />
        <Field label="Sansom project manager" value={d.projectManager} ai={ai.has("projectManager")} onChange={(v) => patchData({ projectManager: v })} />
        <Field label="PM contact phone" type="tel" value={d.projectManagerPhone} ai={ai.has("projectManagerPhone")} onChange={(v) => patchData({ projectManagerPhone: v })} />
        <Field label="Start date" type="date" value={d.startDate ?? ""} ai={ai.has("startDate")} onChange={(v) => patchData({ startDate: v || null })} />
        <Field label="End date" type="date" value={d.endDate ?? ""} ai={ai.has("endDate")} onChange={(v) => patchData({ endDate: v || null })} />
      </Section>

      <Section title="Work type(s)" aside={<AiBadge on={ai.has("workTypes")} />}>
        <div className="sm:col-span-2 flex flex-wrap gap-1.5">
          {WORK_TYPES.map((w) => {
            const on = d.workTypes.includes(w);
            return (
              <button
                key={w}
                type="button"
                onClick={() => patchData({ workTypes: on ? d.workTypes.filter((x) => x !== w) : [...d.workTypes, w] })}
                className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-accent bg-accent text-white" : "border-border bg-white text-neutral-600 hover:bg-neutral-50"}`}
              >
                {on ? "✓ " : ""}
                {w}
              </button>
            );
          })}
        </div>
        <Field
          label="Scope of works"
          wide
          area
          value={d.scope}
          ai={ai.has("scope")}
          onChange={(v) => patchData({ scope: v })}
          placeholder="Sansom will… (work areas, access, key products, exclusions)"
          hint="Printed under Project/Site in the SSSP and on the WorkSafe notification."
        />
        <Field
          label="Sub-contracted works"
          wide
          value={d.subcontractedWorks}
          ai={ai.has("subcontractedWorks")}
          onChange={(v) => patchData({ subcontractedWorks: v })}
          placeholder="e.g. Scaffolding by ABC Scaffolding — leave blank for none"
        />
      </Section>
      <NextButton label="Next: site safety" onClick={onNext} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Site safety — YES / N/A questions, environment, notifiable works
// ---------------------------------------------------------------------------

function SafetyTab({ s, ai, patchData, onNext }: { s: SsspFull; ai: Set<string>; patchData: (d: Partial<SsspData>) => void; onNext: () => void }) {
  const d = s.data;
  const setAnswer = (id: string, v: AnswerOption) => patchData({ answers: { [id]: v } as SsspData["answers"] });
  const [showStandard, setShowStandard] = useState(false);
  const unanswered = QUESTIONS.filter((q) => !d.answers[q.id]).length;

  const row = (q: (typeof QUESTIONS)[number]) => (
    <div key={q.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${!d.answers[q.id] ? "bg-amber-50/60 -mx-2 px-2 rounded" : ""}`}>
      <span className="text-sm text-neutral-800 flex-1 min-w-[240px] flex items-center gap-1.5">
        {q.text}
        <AiBadge on={ai.has(`answers.${q.id}`)} />
      </span>
      <span className="inline-flex rounded-lg border border-border overflow-hidden shrink-0">
        {q.options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setAnswer(q.id, o)}
            className={`px-3 py-1 text-xs ${d.answers[q.id] === o ? (o === "na" ? "bg-neutral-600 text-white" : "bg-accent text-white") : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
          >
            {OPTION_LABELS[o]}
          </button>
        ))}
      </span>
    </div>
  );

  const jobSpecific = QUESTIONS.filter((q) => q.ai && q.group !== "environment");
  return (
    <div className="max-w-4xl space-y-6">
      {unanswered > 0 && <p className="text-sm text-amber-800 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">{unanswered} question{unanswered === 1 ? "" : "s"} still to answer — highlighted below.</p>}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-1">Job-specific questions</h2>
        <p className="text-xs text-neutral-500 mb-3">These change from job to job.</p>
        <div className="divide-y divide-border">{jobSpecific.map(row)}</div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-3">Environmental</h2>
        <div className="divide-y divide-border">
          {QUESTIONS.filter((q) => q.group === "environment").map((q) => {
            const key = q.id.replace("env_", "") as "dust" | "noise" | "water";
            return (
              <div key={q.id}>
                {row(q)}
                {q.id !== "env_plan" && d.answers[q.id] === "yes" && (
                  <div className="pb-3">
                    <Field
                      label="How will this be controlled?"
                      value={d.controls[key]}
                      ai={ai.has(`controls.${key}`)}
                      onChange={(v) => patchData({ controls: { [key]: v } as SsspData["controls"] })}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {d.answers.notifiable === "yes" && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
            Notifiable work (WorkSafe) <AiBadge on={ai.has("notifiableWorks")} />
          </h2>
          <p className="text-xs text-neutral-500 mb-3">Ticked on the Notification of Particular Hazardous Work page. Notify WorkSafe at least 24 hours before work starts.</p>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {NOTIFIABLE_WORKS.map((w) => {
              const on = d.notifiableWorks.includes(w);
              return (
                <label key={w} className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={on} onChange={() => patchData({ notifiableWorks: on ? d.notifiableWorks.filter((x) => x !== w) : [...d.notifiableWorks, w] })} className="mt-0.5" />
                  {w}
                </label>
              );
            })}
          </div>
          <div className="mt-3">
            <Field label="Other notifiable work" value={d.notifiableOther} ai={ai.has("notifiableOther")} onChange={(v) => patchData({ notifiableOther: v })} />
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <button onClick={() => setShowStandard((v) => !v)} className="w-full flex items-center justify-between text-sm font-semibold">
          <span>Sansom standard answers</span>
          <span className="text-xs font-normal text-neutral-500">{showStandard ? "Hide" : "Show / change"} ({QUESTIONS.filter((q) => !q.ai).length})</span>
        </button>
        {showStandard && (
          <div className="mt-3 space-y-4">
            {QUESTION_GROUPS.filter((g) => g.id !== "environment").map((g) => {
              const qs = QUESTIONS.filter((q) => q.group === g.id && !q.ai);
              if (!qs.length) return null;
              return (
                <div key={g.id}>
                  <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1">{g.title}</p>
                  <div className="divide-y divide-border">{qs.map(row)}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <NextButton label="Next: site risks" onClick={onNext} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Site risks (register picker)
// ---------------------------------------------------------------------------

function RatingChip({ score }: { score: number | null }) {
  const level = scoreLevel(score);
  return level ? <span className={`text-[11px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${LEVEL_COLORS[level]}`}>{ratingLabel(score)}</span> : null;
}

function RisksTab({ s, ai, register, patchData, onNext }: { s: SsspFull; ai: Set<string>; register: Risk[]; patchData: (d: Partial<SsspData>) => void; onNext: () => void }) {
  const d = s.data;
  const [scope, setScope] = useState<"selected" | "site" | "all">("selected");
  const [q, setQ] = useState("");
  const selected = new Set(d.riskIds);
  const list = useMemo(() => {
    let r = register.filter((x) => x.status !== "Closed");
    if (scope === "selected") r = r.filter((x) => selected.has(x.id));
    if (scope === "site") r = r.filter((x) => x.id.startsWith("TAC") || x.id.startsWith("PRO"));
    const t = q.trim().toLowerCase();
    if (t) r = r.filter((x) => [x.id, x.title, x.description].some((v) => v.toLowerCase().includes(t)));
    const rank = (id: string) => (id.startsWith("TAC") ? 0 : id.startsWith("PRO") ? 1 : 2);
    return r.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id, undefined, { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, scope, q, d.riskIds]);

  const toggle = (id: string) => patchData({ riskIds: selected.has(id) ? d.riskIds.filter((x) => x !== id) : [...d.riskIds, id] });

  return (
    <div className="max-w-4xl space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-neutral-600">
        The SSSP&apos;s risk register lists only the risks ticked here, with their ratings and controls straight from the Sansom register. <b>{d.riskIds.length}</b> selected
        <AiBadge on={ai.has("riskIds")} />.
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {(["selected", "site", "all"] as const).map((v) => (
          <button key={v} onClick={() => setScope(v)} className={`rounded-full border px-3 py-1 text-xs ${scope === v ? "border-accent bg-accent text-white" : "border-border bg-white text-neutral-600"}`}>
            {v === "selected" ? `Selected (${d.riskIds.length})` : v === "site" ? "Site & procedural risks" : "Whole register"}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search risks…" className="ml-auto rounded-lg border border-border px-3 py-1.5 text-sm w-60" />
      </div>
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {list.length === 0 && <p className="p-6 text-sm text-neutral-500 text-center">{scope === "selected" ? "No risks selected yet — use “Site & procedural risks” to pick, or build with AI." : "No risks match."}</p>}
        {list.map((r) => (
          <label key={r.id} className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-neutral-50">
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="mt-1" />
            <span className="flex-1 min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="mono-id text-neutral-400">{r.id}</span>
                <span className="text-sm font-medium text-neutral-900">{r.title}</span>
                {(r.inherentScore ?? 0) >= 15 && <span className="text-[10px] font-semibold text-red-700 border border-red-200 bg-red-50 rounded px-1">CRITICAL RISK</span>}
              </span>
              <span className="block text-xs text-neutral-500 line-clamp-2 mt-0.5">{r.description}</span>
              {d.riskReasons[r.id] && selected.has(r.id) && <span className="block text-xs text-indigo-700 mt-0.5">{d.riskReasons[r.id]}</span>}
            </span>
            <span className="flex flex-col items-end gap-1 shrink-0">
              <RatingChip score={r.inherentScore} />
              <span className="text-[10px] text-neutral-400">→</span>
              <RatingChip score={r.residualScore} />
            </span>
          </label>
        ))}
      </div>
      <NextButton label="Next: hazardous substances" onClick={onNext} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Hazardous substances (chemical register picker)
// ---------------------------------------------------------------------------

function SubstancesTab({
  s,
  ai,
  chemicals,
  setChemicals,
  patchData,
  onNext,
}: {
  s: SsspFull;
  ai: Set<string>;
  chemicals: Chemical[];
  setChemicals: (fn: (c: Chemical[]) => Chemical[]) => void;
  patchData: (d: Partial<SsspData>) => void;
  onNext: () => void;
}) {
  const d = s.data;
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const byId = useMemo(() => new Map(chemicals.map((c) => [c.id, c])), [chemicals]);
  const selected = d.chemicalIds.map((id) => byId.get(id)).filter((c): c is Chemical => !!c);
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return chemicals
      .filter((c) => c.status !== "No Longer in Use" && !d.chemicalIds.includes(c.id))
      .filter((c) => [c.productName, c.id, c.unNumber].some((v) => v.toLowerCase().includes(t)))
      .slice(0, 12);
  }, [q, chemicals, d.chemicalIds]);

  const add = (id: string) => {
    const extra: Partial<SsspData> = { chemicalIds: [...d.chemicalIds, id] };
    if (!d.answers.hazardous_products) extra.answers = { hazardous_products: "yes", hazardous_recorded: "yes", sds_provided: "yes" } as SsspData["answers"];
    patchData(extra);
    setQ("");
  };

  async function addToRegister(name: string) {
    setAdding(name);
    const res = await fetch("/api/chemicals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productName: name, notes: `Added from ${s.id}` }) });
    const data = await res.json();
    setAdding(null);
    if (!res.ok) return alert(data.error || "Couldn't add");
    setChemicals((list) => [...list, data.chemical]);
    patchData({ chemicalIds: [...d.chemicalIds, data.chemical.id], unmatchedProducts: d.unmatchedProducts.filter((p) => p !== name) });
  }

  const expired = selected.filter((c) => sdsState(c) === "expired");
  const drafts = selected.filter((c) => c.status !== "Approved for Use");

  return (
    <div className="max-w-4xl space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-neutral-600">
        Products listed here fill the SSSP&apos;s <b>Hazardous Substance Register</b> and <b>Safety Data Information</b> tables, straight from the chemical register.{" "}
        <b>{selected.length}</b> selected <AiBadge on={ai.has("chemicalIds")} />
      </div>

      {(expired.length > 0 || drafts.length > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-0.5">
          {expired.length > 0 && <p>SDS expired for: {expired.map((c) => c.productName).join(", ")} — get a current SDS before work starts.</p>}
          {drafts.length > 0 && <p>Not yet approved for use: {drafts.map((c) => c.productName).join(", ")} — H&amp;S need to approve these in the chemical register.</p>}
        </div>
      )}

      {d.unmatchedProducts.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
          <p className="text-sm font-medium text-indigo-950 mb-1">Products in the documents that aren&apos;t in the chemical register</p>
          <p className="text-xs text-indigo-900/70 mb-2">Search for them under another name below, or add them to the register as a draft for H&amp;S to approve.</p>
          <div className="flex flex-wrap gap-1.5">
            {d.unmatchedProducts.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white pl-3 pr-1 py-0.5 text-xs">
                {p}
                <button onClick={() => setQ(p.split(/\s+/).slice(0, 2).join(" "))} className="px-1.5 text-indigo-700 hover:underline">search</button>
                <button onClick={() => addToRegister(p)} disabled={adding === p} className="px-1.5 text-indigo-700 hover:underline">{adding === p ? "adding…" : "+ add to register"}</button>
                <button onClick={() => patchData({ unmatchedProducts: d.unmatchedProducts.filter((x) => x !== p) })} className="px-1 text-neutral-400 hover:text-red-600" aria-label="Dismiss">✕</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="relative">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a product — search the chemical register (name, UN number, record ID)…" className={inputCls} />
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-xl border border-border bg-white shadow-lg max-h-80 overflow-y-auto">
            {results.map((c) => (
              <button key={c.id} onClick={() => add(c.id)} className="w-full text-left px-3 py-2 hover:bg-neutral-50 flex items-center justify-between gap-3 border-b border-border last:border-0">
                <span className="min-w-0">
                  <span className="text-sm text-neutral-900">{c.productName}</span>
                  <span className="text-xs text-neutral-400 ml-2">{c.id} · {c.unNumber || "—"}</span>
                </span>
                {sdsState(c) !== "ok" && <SdsBadge chemical={c} />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {selected.length === 0 && <p className="p-6 text-sm text-neutral-500 text-center">No products selected.</p>}
        {selected.map((c) => (
          <div key={c.id} className="flex items-start gap-3 px-4 py-3">
            <span className="flex-1 min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="mono-id text-neutral-400">{c.id}</span>
                <span className="text-sm font-medium text-neutral-900">{c.productName}</span>
                <span className="text-xs text-neutral-500">{c.unNumber}</span>
                {c.status !== "Approved for Use" && <span className="text-[11px] text-amber-700">{c.status}</span>}
              </span>
              <span className="flex flex-wrap items-center gap-2 mt-1">
                <HazardChips hazards={c.hazards} />
                {sdsState(c) !== "ok" && <SdsBadge chemical={c} />}
              </span>
              {d.chemicalReasons[c.id] && <span className="block text-xs text-indigo-700 mt-0.5">{d.chemicalReasons[c.id]}</span>}
            </span>
            <button onClick={() => patchData({ chemicalIds: d.chemicalIds.filter((x) => x !== c.id) })} className="text-xs text-neutral-400 hover:text-red-600 shrink-0">
              Remove
            </button>
          </div>
        ))}
      </div>
      <NextButton label="Next: emergency" onClick={onNext} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Emergency
// ---------------------------------------------------------------------------

function EmergencyTab({ s, ai, patchData, onNext }: { s: SsspFull; ai: Set<string>; patchData: (d: Partial<SsspData>) => void; onNext: () => void }) {
  const e = s.data.emergency;
  const c = s.data.contacts;
  const setE = (k: keyof typeof e, v: string) => patchData({ emergency: { [k]: v } as SsspData["emergency"] });
  const setC = (k: keyof typeof c, v: string) => patchData({ contacts: { [k]: v } as SsspData["contacts"] });
  return (
    <div className="max-w-4xl space-y-6">
      <Section title="Evacuation">
        <Field label="Assembly point" wide value={e.assemblyPoint} ai={ai.has("emergency.assemblyPoint")} onChange={(v) => setE("assemblyPoint", v)} placeholder="Usually given at the main contractor's induction" />
        <Field label="Nearest hospital (A&E)" value={e.hospital} ai={ai.has("emergency.hospital")} onChange={(v) => setE("hospital", v)} />
        <Field label="Hospital phone" value={e.hospitalPhone} ai={ai.has("emergency.hospitalPhone")} onChange={(v) => setE("hospitalPhone", v)} />
      </Section>

      <Section title="Emergency response plan">
        <Field label="Type of emergency" value={e.emergencyType} ai={ai.has("emergency.emergencyType")} onChange={(v) => setE("emergencyType", v)} placeholder="e.g. Fall from height / suspended in harness" />
        <Field label="Location" value={e.location} ai={ai.has("emergency.location")} onChange={(v) => setE("location", v)} />
        <Field label="Work activity" value={e.workActivity} ai={ai.has("emergency.workActivity")} onChange={(v) => setE("workActivity", v)} />
        <Field label="Equipment required" value={e.equipment} ai={ai.has("emergency.equipment")} onChange={(v) => setE("equipment", v)} />
        <Field label="Rescue method" wide area value={e.rescueMethod} ai={ai.has("emergency.rescueMethod")} onChange={(v) => setE("rescueMethod", v)} />
      </Section>

      <Section title="Emergency contacts">
        <Field label="Site supervisor" value={c.siteSupervisor} ai={ai.has("contacts.siteSupervisor")} onChange={(v) => setC("siteSupervisor", v)} />
        <Field label="Phone" type="tel" value={c.siteSupervisorPhone} ai={ai.has("contacts.siteSupervisorPhone")} onChange={(v) => setC("siteSupervisorPhone", v)} />
        <Field label="Site first aider" value={c.firstAider} ai={ai.has("contacts.firstAider")} onChange={(v) => setC("firstAider", v)} />
        <Field label="Phone" type="tel" value={c.firstAiderPhone} ai={ai.has("contacts.firstAiderPhone")} onChange={(v) => setC("firstAiderPhone", v)} />
        <Field label="Contracts manager" value={c.contractsManager1} ai={ai.has("contacts.contractsManager1")} onChange={(v) => setC("contractsManager1", v)} hint={`Blank = the project manager (${s.data.projectManager || "not set"})`} />
        <Field label="Phone" type="tel" value={c.contractsManager1Phone} onChange={(v) => setC("contractsManager1Phone", v)} />
        <Field label="Second contracts manager" value={c.contractsManager2} onChange={(v) => setC("contractsManager2", v)} />
        <Field label="Phone" type="tel" value={c.contractsManager2Phone} onChange={(v) => setC("contractsManager2Phone", v)} />
        <Field label="Director" value={c.director} onChange={(v) => setC("director", v)} />
        <Field label="Phone" type="tel" value={c.directorPhone} onChange={(v) => setC("directorPhone", v)} />
      </Section>
      <NextButton label="Next: review & submit" onClick={onNext} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Review & submit
// ---------------------------------------------------------------------------

type Delivery = { status: "sent" | "failed" | "skipped"; message: string };

function ReviewTab({
  s,
  user,
  register,
  chemicals,
  webhookConfigured,
  flush,
  onUpdated,
  onGoTo,
}: {
  s: SsspFull;
  user: { id: string; role: string };
  register: Risk[];
  chemicals: Chemical[];
  webhookConfigured: boolean;
  flush: () => Promise<boolean>;
  onUpdated: (s: SsspFull) => void;
  onGoTo: (t: Tab) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [comment, setComment] = useState("");
  const editable = EDITABLE_TA_STATUSES.includes(s.status);
  const problems = ssspProblems(s);
  const isReviewer = canReviewRole(user.role) && (user.role === "admin" || user.id !== s.preparedById);
  const d = s.data;
  const riskById = new Map(register.map((r) => [r.id, r]));
  const chemById = new Map(chemicals.map((c) => [c.id, c]));
  const expired = d.chemicalIds.map((id) => chemById.get(id)).filter((c): c is Chemical => !!c && sdsState(c) === "expired");

  async function call(action: string, url: string, body?: unknown) {
    setBusy(action);
    setError(null);
    setDelivery(null);
    try {
      if (!(await flush())) throw new Error("Couldn't save your latest changes — check your connection and try again.");
      const res = await fetch(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error([data.error, ...(data.problems || [])].filter(Boolean).join(" "));
      onUpdated(data.sssp);
      if (data.delivery) setDelivery(data.delivery);
      setComment("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-4xl space-y-5">
      {s.reviewComment && (s.status === "changes_requested" || s.status === "approved") && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${s.status === "changes_requested" ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          <p className="font-medium">{s.status === "changes_requested" ? "Changes requested" : "Approved"} by {s.reviewedByName}</p>
          <p className="mt-0.5 whitespace-pre-wrap">{s.reviewComment}</p>
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-3">Summary</h2>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {[
            ["Job", [s.jobNumber, s.projectName].filter(Boolean).join(" – ") || "—"],
            ["Site", s.siteAddress || "—"],
            ["Main contractor", s.mainContractor || "—"],
            ["Project manager", d.projectManager || "—"],
            ["Dates", [d.startDate, d.endDate].filter(Boolean).join(" → ") || "—"],
            ["Work types", d.workTypes.join(", ") || "—"],
            ["Site supervisor / first aider", [d.contacts.siteSupervisor, d.contacts.firstAider].filter(Boolean).join(" / ") || "—"],
            ["Assembly point", d.emergency.assemblyPoint || "—"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-neutral-500">{k}</dt>
              <dd className="text-neutral-900">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 grid sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-neutral-500 mb-1">Site risks ({d.riskIds.length})</p>
            <ul className="text-sm space-y-0.5 max-h-48 overflow-y-auto">
              {d.riskIds.map((id) => (
                <li key={id} className="flex items-center gap-2">
                  <span className="mono-id text-neutral-400">{id}</span>
                  <span className="truncate">{riskById.get(id)?.title ?? "(removed from register)"}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs text-neutral-500 mb-1">Hazardous substances ({d.chemicalIds.length})</p>
            <ul className="text-sm space-y-0.5 max-h-48 overflow-y-auto">
              {d.chemicalIds.map((id) => (
                <li key={id} className="truncate">
                  {chemById.get(id)?.productName ?? id}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {editable && (
        <section className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Submit for H&amp;S review</h2>
          {problems.length > 0 ? (
            <ul className="text-sm text-amber-900 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-0.5 list-disc pl-6">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-emerald-800">✓ Ready to submit.</p>
          )}
          {expired.length > 0 && <p className="text-xs text-amber-800">Heads-up: {expired.length} product{expired.length === 1 ? " has an" : "s have"} expired SDS ({expired.map((c) => c.productName).join(", ")}).</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => call("submit", `/api/sssps/${s.id}/submit`)}
              disabled={!!busy || problems.length > 0}
              className="rounded-lg bg-accent text-white text-sm font-medium px-4 py-2 hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy === "submit" ? "Submitting…" : s.status === "changes_requested" ? "Resubmit for review" : "Submit for H&S review"}
            </button>
            {problems.length > 0 && (
              <button onClick={() => onGoTo(problems.some((p) => /question/.test(p)) ? "safety" : "project")} className="text-sm text-neutral-600 hover:text-neutral-900">
                Fix these →
              </button>
            )}
          </div>
          <p className="text-xs text-neutral-400">
            Locks the SSSP and {webhookConfigured ? "sends it to Make.com (event sssp.submitted) to email the H&S manager." : "notifies H&S (Make.com isn't configured, so no email is sent)."}
          </p>
        </section>
      )}

      {s.status === "submitted" && (
        <section className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">H&amp;S review</h2>
          {isReviewer ? (
            <>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Comment (required when requesting changes)" className={inputCls} />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => call("approve", `/api/sssps/${s.id}/review`, { decision: "approve", comment })} disabled={!!busy} className="rounded-lg bg-emerald-600 text-white text-sm font-medium px-4 py-2 hover:bg-emerald-700 disabled:opacity-50">
                  {busy === "approve" ? "Approving…" : "Approve"}
                </button>
                <button onClick={() => call("changes", `/api/sssps/${s.id}/review`, { decision: "changes", comment })} disabled={!!busy || !comment.trim()} className="rounded-lg border border-red-300 text-red-700 text-sm font-medium px-4 py-2 hover:bg-red-50 disabled:opacity-50">
                  Request changes
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-neutral-600">Waiting for an H&amp;S reviewer{user.id === s.preparedById ? " — you can't review an SSSP you prepared." : "."}</p>
          )}
        </section>
      )}

      {s.status === "approved" && (canReviewRole(user.role) || user.id === s.preparedById) && (
        <section className="rounded-xl border border-border bg-card p-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-neutral-600">Job finished? Close the SSSP.</p>
          <button onClick={() => call("close", `/api/sssps/${s.id}/review`, { decision: "close" })} disabled={!!busy} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-neutral-50">
            Close SSSP
          </button>
        </section>
      )}

      {error && <p className="text-sm text-red-700 rounded-lg border border-red-200 bg-red-50 px-3 py-2">{error}</p>}
      {delivery && (
        <p className={`text-sm rounded-lg border px-3 py-2 ${delivery.status === "sent" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : delivery.status === "failed" ? "border-red-200 bg-red-50 text-red-700" : "border-neutral-200 bg-neutral-50 text-neutral-600"}`}>
          {delivery.message}
        </p>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-3">Timeline</h2>
        <ol className="space-y-2">
          {s.events.map((e) => (
            <li key={e.id} className="text-sm flex gap-3">
              <span className="text-xs text-neutral-400 w-36 shrink-0">{new Date(e.createdAt).toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" })}</span>
              <span className="min-w-0">
                <span className="text-neutral-800">{SSSP_EVENT_LABELS[e.type] ?? e.type}</span>
                <span className="text-neutral-400"> · {e.actorName}</span>
                {e.detail && <span className="block text-xs text-neutral-500 break-words">{e.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
