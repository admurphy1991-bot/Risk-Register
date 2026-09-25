"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Risk } from "@/lib/types";
import {
  EDITABLE_TA_STATUSES,
  PERMIT_OPTIONS,
  PPE_OPTIONS,
  validateForSubmission,
  type ChemicalItem,
  type PlantItem,
  type TaFull,
  type TaStep,
} from "@/lib/ta-shared";
import { TaStatusBadge } from "@/components/ta/TaStatusBadge";
import { StepsEditor } from "@/components/ta/StepsEditor";
import { ReviewPanel } from "@/components/ta/ReviewPanel";

type Tab = "documents" | "details" | "steps" | "review";
type SaveState = "idle" | "saving" | "saved" | "error";
type HeaderPatch = Partial<Omit<TaFull, "steps" | "files" | "events" | "deliveries">>;

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "documents", label: "Documents", hint: "Drop in the proposal & evidence" },
  { id: "details", label: "Project details", hint: "Check what was captured" },
  { id: "steps", label: "Risks & controls", hint: "Steps from the register" },
  { id: "review", label: "Review & submit", hint: "Send for H&S review" },
];

const ACCEPT = ".pdf,.docx,.txt,.md,.csv,.eml,.png,.jpg,.jpeg,.webp";

export default function TaBuilder({ taId, user }: { taId: string; user: { id: string; name: string; role: string } }) {
  const router = useRouter();
  const [ta, setTa] = useState<TaFull | null>(null);
  const [register, setRegister] = useState<Risk[]>([]);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [tab, setTab] = useState<Tab>("documents");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // --- Autosave plumbing -------------------------------------------------
  const pendingHeader = useRef<HeaderPatch>({});
  const pendingSteps = useRef<TaStep[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) await inFlight.current;
    const header = pendingHeader.current;
    const steps = pendingSteps.current;
    if (!Object.keys(header).length && !steps) return true;
    pendingHeader.current = {};
    pendingSteps.current = null;
    setSaveState("saving");
    const work = (async () => {
      try {
        if (Object.keys(header).length) {
          const res = await fetch(`/api/tas/${taId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(header) });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          // Only take server-owned fields so in-progress typing isn't clobbered.
          setTa((prev) => (prev ? { ...prev, aiFilledFields: data.ta.aiFilledFields, updatedAt: data.ta.updatedAt } : prev));
        }
        if (steps) {
          const res = await fetch(`/api/tas/${taId}/steps`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steps }) });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
        }
        setSaveState("saved");
        return true;
      } catch {
        // Put the unsaved changes back so the next save retries them.
        pendingHeader.current = { ...header, ...pendingHeader.current };
        if (steps && !pendingSteps.current) pendingSteps.current = steps;
        setSaveState("error");
        return false;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = work;
    return work;
  }, [taId]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSaveState("saving");
    timer.current = setTimeout(() => void flush(), 700);
  }, [flush]);

  const patchHeader = useCallback(
    (patch: HeaderPatch) => {
      setTa((prev) => (prev ? { ...prev, ...patch } : prev));
      pendingHeader.current = { ...pendingHeader.current, ...patch };
      schedule();
    },
    [schedule]
  );

  const setSteps = useCallback(
    (steps: TaStep[]) => {
      setTa((prev) => (prev ? { ...prev, steps } : prev));
      pendingSteps.current = steps;
      schedule();
    },
    [schedule]
  );

  // Save before leaving the page.
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

  // --- Load --------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [taRes, riskRes, settingsRes] = await Promise.all([
          fetch(`/api/tas/${taId}`),
          fetch("/api/risks"),
          fetch("/api/settings/ta-workflow"),
        ]);
        const taData = await taRes.json();
        if (!taRes.ok) throw new Error(taData.error || "Couldn't load this TA");
        const riskData = await riskRes.json();
        const settingsData = await settingsRes.json();
        if (cancelled) return;
        const loaded: TaFull = taData.ta;
        setTa(loaded);
        setRegister(riskData.risks || []);
        setAiConfigured(!!settingsData.aiConfigured);
        setWebhookConfigured(!!settingsData.settings?.makeWebhookUrl);
        const editable = EDITABLE_TA_STATUSES.includes(loaded.status);
        setTab(
          !editable ? "review" : loaded.files.length === 0 && !loaded.projectName ? "documents" : loaded.steps.length === 0 ? "details" : "steps"
        );
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taId]);

  const registerTitles = useMemo(() => new Map(register.map((r) => [r.id, r.title])), [register]);

  if (loadError) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-red-600 mb-3">{loadError}</p>
        <Link href="/tas" className="text-sm text-accent hover:underline">← Back to task analyses</Link>
      </div>
    );
  }
  if (!ta) return <p className="py-16 text-center text-sm text-neutral-400">Loading…</p>;

  const editable = EDITABLE_TA_STATUSES.includes(ta.status);
  const problems = validateForSubmission(ta);

  async function changeTab(next: Tab) {
    await flush();
    setTab(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteDraft() {
    if (!ta || !confirm(`Delete ${ta.id}? This can't be undone.`)) return;
    const res = await fetch(`/api/tas/${ta.id}`, { method: "DELETE" });
    if (res.ok) router.push("/tas");
    else alert((await res.json()).error || "Couldn't delete");
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <Link href="/tas" className="text-xs text-neutral-500 hover:text-neutral-800">← Task analyses</Link>
          <h1 className="text-xl font-semibold tracking-tight mt-1 truncate">
            {ta.jobNumber && <span className="text-neutral-500 mr-2">{ta.jobNumber}</span>}
            {ta.projectName || "New task analysis"}
          </h1>
          <div className="flex items-center gap-2 mt-1 text-xs text-neutral-500">
            <span className="mono-id">{ta.id}</span>
            <TaStatusBadge status={ta.status} />
            <span>· prepared by {ta.preparedByName}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {editable && (
            <span className={`text-xs ${saveState === "error" ? "text-red-600" : "text-neutral-400"}`}>
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "All changes saved" : saveState === "error" ? "Save failed — retrying on next change" : ""}
            </span>
          )}
          <a href={`/api/tas/${ta.id}/document`} onClick={() => void flush()} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-neutral-50">
            Download Word
          </a>
          {ta.status === "draft" && (user.role === "admin" || user.id === ta.preparedById) && (
            <button onClick={deleteDraft} className="text-xs text-neutral-400 hover:text-red-600">Delete draft</button>
          )}
        </div>
      </div>

      {/* Stepper */}
      {editable && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
          {TABS.map((t, i) => {
            const active = tab === t.id;
            const done =
              (t.id === "documents" && ta.files.length > 0) ||
              (t.id === "details" && !!ta.projectName && !!ta.overview) ||
              (t.id === "steps" && ta.steps.length > 0) ||
              (t.id === "review" && problems.length === 0);
            return (
              <button
                key={t.id}
                onClick={() => changeTab(t.id)}
                className={`text-left rounded-xl border px-3 py-2 transition ${
                  active ? "border-accent bg-accent-soft" : "border-border bg-card hover:bg-neutral-50"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-5 w-5 rounded-full text-[11px] font-semibold flex items-center justify-center ${
                      done ? "bg-emerald-500 text-white" : active ? "bg-accent text-white" : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span className={`text-sm ${active ? "font-medium text-accent" : "text-neutral-800"}`}>{t.label}</span>
                </span>
                <span className="block text-[11px] text-neutral-500 mt-0.5 pl-7">{t.hint}</span>
              </button>
            );
          })}
        </div>
      )}

      {editable && tab === "documents" && (
        <DocumentsStep ta={ta} aiConfigured={aiConfigured} onUpdated={setTa} onNext={() => changeTab("details")} />
      )}
      {editable && tab === "details" && <DetailsStep ta={ta} patch={patchHeader} onNext={() => changeTab("steps")} />}
      {editable && tab === "steps" && (
        <>
          <StepsEditor taId={ta.id} steps={ta.steps} register={register} onChange={setSteps} aiConfigured={aiConfigured} canSuggest />
          <div className="flex justify-end mt-6">
            <button onClick={() => changeTab("review")} className="rounded-lg bg-accent text-white text-sm font-medium px-4 py-2 hover:bg-indigo-700">
              Next: review &amp; submit →
            </button>
          </div>
        </>
      )}
      {(!editable || tab === "review") && (
        <ReviewPanel
          ta={ta}
          user={user}
          webhookConfigured={webhookConfigured}
          flush={flush}
          registerTitles={registerTitles}
          onUpdated={(next) => {
            setTa(next);
            if (EDITABLE_TA_STATUSES.includes(next.status)) setTab("review");
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Documents
// ---------------------------------------------------------------------------

function DocumentsStep({
  ta,
  aiConfigured,
  onUpdated,
  onNext,
}: {
  ta: TaFull;
  aiConfigured: boolean;
  onUpdated: (ta: TaFull) => void;
  onNext: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<{ applied: string[]; kept: string[]; notes: string | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    setErrors([]);
    try {
      const form = new FormData();
      list.forEach((f) => form.append("files", f));
      const res = await fetch(`/api/tas/${ta.id}/files`, { method: "POST", body: form });
      const data = await res.json();
      if (data.errors?.length) setErrors(data.errors);
      else if (!res.ok) setErrors([data.error || "Upload failed"]);
      if (data.files?.length) onUpdated({ ...ta, files: [...ta.files, ...data.files] });
    } catch {
      setErrors(["Upload failed — check your connection and try again."]);
    } finally {
      setUploading(false);
    }
  }

  async function remove(fileId: string) {
    const res = await fetch(`/api/tas/${ta.id}/files/${fileId}`, { method: "DELETE" });
    if (res.ok) onUpdated({ ...ta, files: ta.files.filter((f) => f.id !== fileId) });
  }

  async function extract() {
    setExtracting(true);
    setErrors([]);
    setResult(null);
    try {
      const res = await fetch(`/api/tas/${ta.id}/extract`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't read the documents");
      onUpdated(data.ta);
      setResult({ applied: data.applied, kept: data.kept, notes: data.notes });
    } catch (err) {
      setErrors([(err as Error).message]);
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
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
        className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
          dragging ? "border-accent bg-accent-soft" : "border-border bg-card hover:bg-neutral-50"
        }`}
      >
        <p className="text-base font-medium text-neutral-800">{uploading ? "Uploading…" : "Drop the proposal and any supporting documents here"}</p>
        <p className="text-sm text-neutral-500 mt-1">
          Accepted quote / proposal, scope of works, client emails (.eml), site notes, photos — anything with the job name, number,
          site details or scope.
        </p>
        <p className="text-xs text-neutral-400 mt-3">PDF · Word (.docx) · email (.eml) · text · images — or click to browse</p>
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
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 space-y-0.5">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      {ta.files.length > 0 && (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {ta.files.map((f) => (
            <div key={f.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate text-neutral-800">{f.filename}</p>
                <p className="text-xs text-neutral-400">
                  {f.sizeBytes < 1024 * 1024 ? `${Math.max(1, Math.round(f.sizeBytes / 1024))} KB` : `${(f.sizeBytes / 1024 / 1024).toFixed(1)} MB`} · {f.mimeType.includes("pdf") ? "PDF" : f.mimeType.startsWith("image/") ? "Image" : f.hasText ? "Text extracted" : "Stored"}
                </p>
              </div>
              <button onClick={() => remove(f.id)} className="text-xs text-neutral-400 hover:text-red-600 shrink-0 ml-3">Remove</button>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <p className="font-medium">
            {result.applied.length ? `Filled ${result.applied.length} field${result.applied.length === 1 ? "" : "s"} from the documents.` : "No new details found in the documents."}
          </p>
          {result.kept.length > 0 && (
            <p className="text-xs mt-1 text-emerald-800">
              Kept what you&apos;d already typed for: {result.kept.join(", ")} (the documents say something different — worth a check).
            </p>
          )}
          {result.notes && <p className="text-xs mt-1 text-emerald-800">AI notes: {result.notes}</p>}
          <button onClick={onNext} className="mt-2 rounded-md bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 hover:bg-emerald-700">
            Check the project details →
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={extract}
          disabled={extracting || ta.files.length === 0 || !aiConfigured}
          className="rounded-lg bg-accent text-white text-sm font-medium px-4 py-2 hover:bg-indigo-700 disabled:opacity-50"
        >
          {extracting ? "Reading documents… (~20s)" : "✦ Read documents & fill in details"}
        </button>
        <button onClick={onNext} className="text-sm text-neutral-600 hover:text-neutral-900">
          {ta.files.length ? "Continue without reading →" : "Skip — fill in details manually →"}
        </button>
      </div>
      {!aiConfigured && (
        <p className="text-xs text-amber-700">
          AI reading isn&apos;t available — ANTHROPIC_API_KEY isn&apos;t configured on the server. You can still fill the details manually.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Project details
// ---------------------------------------------------------------------------

function DetailsStep({ ta, patch, onNext }: { ta: TaFull; patch: (p: HeaderPatch) => void; onNext: () => void }) {
  const ai = new Set(ta.aiFilledFields);

  const field = (key: keyof HeaderPatch, label: string, opts: { placeholder?: string; type?: string; wide?: boolean; area?: boolean } = {}) => (
    <label className={`block ${opts.wide ? "sm:col-span-2" : ""}`}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 mb-1">
        {label}
        {ai.has(key) && <span className="rounded bg-indigo-100 text-indigo-700 px-1 text-[10px] font-semibold" title="Filled from your documents by AI — please check">✦ AI</span>}
      </span>
      {opts.area ? (
        <textarea
          value={(ta[key as keyof TaFull] as string) ?? ""}
          onChange={(e) => patch({ [key]: e.target.value })}
          rows={5}
          placeholder={opts.placeholder}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      ) : (
        <input
          type={opts.type || "text"}
          value={(ta[key as keyof TaFull] as string) ?? ""}
          onChange={(e) => patch({ [key]: e.target.value })}
          placeholder={opts.placeholder}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      )}
    </label>
  );

  return (
    <div className="max-w-4xl space-y-6">
      <Section title="Job">
        {field("jobNumber", "Job number", { placeholder: "e.g. S34144" })}
        {field("taDate", "Date", { type: "date" })}
        {field("projectName", "Project name", { placeholder: "e.g. THE GALLERIES 23 GRAHAM ST WATERPROOFING REMEDIATION WORKS", wide: true })}
        {field("workType", "Work type", { placeholder: "e.g. Waterproofing remediation works to selected Ground Floor and Level 4 areas", wide: true })}
      </Section>

      <Section title="Site & contacts">
        {field("siteAddress", "Location", { placeholder: "Street address" })}
        {field("mainContractor", "Main contractor / client")}
        {field("siteContactName", "Site contact person")}
        {field("siteContactPhone", "Site contact phone", { type: "tel" })}
        {field("contractManager", "Sansom contract manager")}
        {field("contractManagerPhone", "Sansom contact phone", { type: "tel" })}
      </Section>

      <Section title="Scope">
        {field("overview", "Overview of the work", {
          area: true,
          wide: true,
          placeholder: "Sansom Construction Systems will undertake… (each work area, access method, products, exclusions)",
        })}
        <div className="sm:col-span-2">
          <ChipList
            label="Permits needed"
            ai={ai.has("permits")}
            options={PERMIT_OPTIONS}
            values={ta.permits}
            onChange={(permits) => patch({ permits })}
            addPlaceholder="Other permit — e.g. Site Permit to Work (building management)"
          />
        </div>
        <div className="sm:col-span-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 mb-1.5">
            PPE required
            {ai.has("ppe") && <span className="rounded bg-indigo-100 text-indigo-700 px-1 text-[10px] font-semibold">✦ AI</span>}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {PPE_OPTIONS.map((p) => {
              const on = ta.ppe.includes(p.key);
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => patch({ ppe: on ? ta.ppe.filter((k) => k !== p.key) : [...ta.ppe, p.key] })}
                  className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-accent bg-accent text-white" : "border-border bg-white text-neutral-600 hover:bg-neutral-50"}`}
                >
                  {on ? "✓ " : ""}
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      <Section title="Plant, equipment & hazardous substances">
        <div className="sm:col-span-2">
          <RowList<PlantItem>
            label="Key plant and equipment"
            ai={ai.has("plant")}
            rows={ta.plant}
            blank={{ item: "", operatorRequirements: "" }}
            columns={[
              { key: "item", placeholder: "e.g. Vertical lifter / MEWP", flex: 1 },
              { key: "operatorRequirements", placeholder: "Operator requirements — e.g. Competent operator only, pre-start checks", flex: 1.4 },
            ]}
            onChange={(plant) => patch({ plant })}
          />
        </div>
        <div className="sm:col-span-2">
          <RowList<ChemicalItem>
            label="Chemicals / hazardous substances"
            ai={ai.has("chemicals")}
            rows={ta.chemicals}
            blank={{ name: "", sds: "SDS available onsite" }}
            columns={[
              { key: "name", placeholder: "e.g. SikaRoof i-Cure 22 system", flex: 1.4 },
              { key: "sds", placeholder: "SDS available onsite", flex: 1 },
            ]}
            onChange={(chemicals) => patch({ chemicals })}
          />
        </div>
      </Section>

      <Section title="Compliance & responsibilities">
        <div className="sm:col-span-2">
          <ChipList
            label="Legislation / codes / standards / guidelines"
            options={[]}
            values={ta.legislation}
            onChange={(legislation) => patch({ legislation })}
            addPlaceholder="Add — e.g. WorkSafe NZ working at height good practice guidance"
            listStyle
          />
        </div>
        {field("responsibleCompliance", "Responsible for ensuring compliance", { wide: true })}
        {field("responsibleReview", "Responsible for reviewing the TA", { wide: true })}
        {field("reviewFrequency", "Review date / frequency", { wide: true })}
      </Section>

      <div className="flex justify-end">
        <button onClick={onNext} className="rounded-lg bg-accent text-white text-sm font-medium px-4 py-2 hover:bg-indigo-700">
          Next: risks &amp; controls →
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold mb-4">{title}</h2>
      <div className="grid sm:grid-cols-2 gap-4">{children}</div>
    </section>
  );
}

function ChipList({
  label,
  ai,
  options,
  values,
  onChange,
  addPlaceholder,
  listStyle,
}: {
  label: string;
  ai?: boolean;
  options: string[];
  values: string[];
  onChange: (v: string[]) => void;
  addPlaceholder: string;
  listStyle?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const extras = values.filter((v) => !options.includes(v));
  const add = () => {
    const t = draft.trim();
    if (t && !values.includes(t)) onChange([...values, t]);
    setDraft("");
  };
  return (
    <div>
      <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 mb-1.5">
        {label}
        {ai && <span className="rounded bg-indigo-100 text-indigo-700 px-1 text-[10px] font-semibold">✦ AI</span>}
      </span>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {options.map((o) => {
            const on = values.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => onChange(on ? values.filter((v) => v !== o) : [...values, o])}
                className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-accent bg-accent text-white" : "border-border bg-white text-neutral-600 hover:bg-neutral-50"}`}
              >
                {on ? "✓ " : ""}
                {o}
              </button>
            );
          })}
        </div>
      )}
      {extras.length > 0 && (
        <ul className={listStyle ? "space-y-1 mb-2" : "flex flex-wrap gap-1.5 mb-2"}>
          {extras.map((v) => (
            <li key={v} className={listStyle ? "flex items-center gap-2 text-sm" : "inline-flex items-center gap-1 rounded-full border border-accent bg-accent-soft pl-3 pr-1 py-0.5 text-xs text-accent"}>
              {listStyle && <span className="text-neutral-300">•</span>}
              <span className={listStyle ? "flex-1" : ""}>{v}</span>
              <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="px-1 text-neutral-400 hover:text-red-600" aria-label={`Remove ${v}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={addPlaceholder}
          className="flex-1 rounded-md border border-border px-2.5 py-1.5 text-xs"
        />
        <button type="button" onClick={add} className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-neutral-50">Add</button>
      </div>
    </div>
  );
}

function RowList<T extends Record<string, string>>({
  label,
  ai,
  rows,
  blank,
  columns,
  onChange,
}: {
  label: string;
  ai?: boolean;
  rows: T[];
  blank: T;
  columns: { key: keyof T & string; placeholder: string; flex: number }[];
  onChange: (rows: T[]) => void;
}) {
  return (
    <div>
      <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 mb-1.5">
        {label}
        {ai && <span className="rounded bg-indigo-100 text-indigo-700 px-1 text-[10px] font-semibold">✦ AI</span>}
      </span>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-1.5">
            {columns.map((c) => (
              <input
                key={c.key}
                value={row[c.key] ?? ""}
                onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, [c.key]: e.target.value } : r)))}
                placeholder={c.placeholder}
                style={{ flex: c.flex }}
                className="min-w-0 rounded-md border border-border px-2.5 py-1.5 text-sm"
              />
            ))}
            <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="px-2 text-neutral-300 hover:text-red-600" aria-label="Remove row">
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...rows, { ...blank }])} className="mt-1.5 text-xs text-accent font-medium hover:underline">
        + Add row
      </button>
    </div>
  );
}
