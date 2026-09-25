"use client";

import { useMemo, useState } from "react";
import type { Risk } from "@/lib/types";
import type { TaStep, StepControl } from "@/lib/ta-shared";
import { riskControlStatements } from "@/lib/controls";
import { computeScore } from "@/lib/risk-scoring";
import { RatingBadge, RatingPicker } from "@/components/ta/RatingPicker";
import { RiskPicker } from "@/components/ta/RiskPicker";

// Editor for the job-step table: each step links Sansom register risks, and
// the controls for those risks are offered as ticks so the PM records exactly
// which ones are in place for this job, plus any job-specific extras.

export function newStepId() {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(9)))
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 14);
  return `tst_${rand}`;
}

export function blankStep(): TaStep {
  return {
    id: newStepId(),
    description: "",
    identifiedRisks: [],
    riskIds: [],
    controls: [],
    initialLikelihood: null,
    initialConsequence: null,
    initialScore: null,
    residualLikelihood: null,
    residualConsequence: null,
    residualScore: null,
  };
}

type SuggestedStep = Omit<TaStep, "id" | "initialScore" | "residualScore">;

export function fromSuggestion(s: SuggestedStep): TaStep {
  return {
    ...s,
    id: newStepId(),
    initialScore: computeScore(s.initialLikelihood, s.initialConsequence),
    residualScore: computeScore(s.residualLikelihood, s.residualConsequence),
  };
}

function withScores(s: TaStep): TaStep {
  return {
    ...s,
    initialScore: computeScore(s.initialLikelihood, s.initialConsequence),
    residualScore: computeScore(s.residualLikelihood, s.residualConsequence),
  };
}

export function StepsEditor({
  taId,
  steps,
  register,
  onChange,
  aiConfigured,
  canSuggest,
}: {
  taId: string;
  steps: TaStep[];
  register: Risk[];
  onChange: (steps: TaStep[]) => void;
  aiConfigured: boolean;
  canSuggest: boolean;
}) {
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<TaStep[] | null>(null);
  const [focus, setFocus] = useState("");

  const riskById = useMemo(() => new Map(register.map((r) => [r.id, r])), [register]);
  const statementsByRisk = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of register) m.set(r.id, riskControlStatements(r.controls));
    return m;
  }, [register]);

  function update(id: string, fn: (s: TaStep) => TaStep) {
    onChange(steps.map((s) => (s.id === id ? withScores(fn(s)) : s)));
  }

  function move(index: number, dir: -1 | 1) {
    const next = [...steps];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  }

  function toggleRisk(stepId: string, riskId: string) {
    update(stepId, (s) => {
      const risk = riskById.get(riskId);
      if (s.riskIds.includes(riskId)) {
        // Unlink: also drop controls that came from this risk.
        return { ...s, riskIds: s.riskIds.filter((r) => r !== riskId), controls: s.controls.filter((c) => c.riskId !== riskId) };
      }
      const next = { ...s, riskIds: [...s.riskIds, riskId] };
      if (risk) {
        if (!next.identifiedRisks.some((x) => x.toLowerCase() === risk.title.toLowerCase())) {
          next.identifiedRisks = [...next.identifiedRisks, risk.title];
        }
        // Default the ratings from the register when the step has none yet,
        // or raise the initial rating if this risk is worse.
        const inh = computeScore(risk.inherentLikelihood, risk.inherentConsequence);
        if (risk.inherentLikelihood && risk.inherentConsequence && (s.initialScore === null || (inh ?? 0) > s.initialScore)) {
          next.initialLikelihood = risk.inherentLikelihood;
          next.initialConsequence = risk.inherentConsequence;
        }
        if (s.residualScore === null && risk.residualLikelihood && risk.residualConsequence) {
          next.residualLikelihood = risk.residualLikelihood;
          next.residualConsequence = risk.residualConsequence;
        }
      }
      return next;
    });
  }

  function toggleControl(stepId: string, text: string, riskId: string | null) {
    update(stepId, (s) => {
      const has = s.controls.some((c) => c.text === text);
      return { ...s, controls: has ? s.controls.filter((c) => c.text !== text) : [...s.controls, { text, riskId }] };
    });
  }

  async function suggest() {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const res = await fetch(`/api/tas/${taId}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus: focus.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Suggestion failed");
      const proposed = (data.steps as SuggestedStep[]).map(fromSuggestion);
      if (steps.length === 0) onChange(proposed);
      else setSuggestion(proposed);
    } catch (err) {
      setSuggestError((err as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  const pickerStep = steps.find((s) => s.id === pickerFor);

  return (
    <div className="space-y-4">
      {canSuggest && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-indigo-950">✦ Draft the steps from the register</p>
              <p className="text-xs text-indigo-900/70 mb-2">
                Uses the project details and uploaded documents to propose job steps, link the applicable Sansom register
                risks, and pre-tick the relevant controls. You review and edit everything before it&apos;s submitted.
              </p>
              <input
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                placeholder="Optional: anything to emphasise — e.g. “torch-on membrane at roof edge, no scaffold, lifter access only”"
                className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <button
              onClick={suggest}
              disabled={suggesting || !aiConfigured}
              title={aiConfigured ? undefined : "ANTHROPIC_API_KEY isn't configured on the server"}
              className="rounded-lg bg-accent text-white text-sm font-medium px-4 py-2 hover:bg-indigo-700 disabled:opacity-50 shrink-0"
            >
              {suggesting ? "Drafting steps… (~30s)" : steps.length ? "Suggest steps again" : "Suggest steps & risks"}
            </button>
          </div>
          {!aiConfigured && <p className="text-xs text-amber-700 mt-2">AI isn&apos;t configured on this server — add steps manually below.</p>}
          {suggestError && <p className="text-xs text-red-600 mt-2">{suggestError}</p>}
        </div>
      )}

      {suggestion && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium mb-1">AI suggested {suggestion.length} steps</p>
          <ol className="text-xs text-neutral-600 list-decimal pl-5 mb-3 space-y-0.5">
            {suggestion.map((s) => (
              <li key={s.id}>
                {s.description} <span className="text-neutral-400">— {s.riskIds.join(", ") || "no register risks"}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { onChange(suggestion); setSuggestion(null); }} className="rounded-md bg-accent text-white text-xs font-medium px-3 py-1.5 hover:bg-indigo-700">
              Replace my {steps.length} steps
            </button>
            <button onClick={() => { onChange([...steps, ...suggestion]); setSuggestion(null); }} className="rounded-md border border-border text-xs px-3 py-1.5 hover:bg-neutral-50">
              Add to the end
            </button>
            <button onClick={() => setSuggestion(null)} className="rounded-md text-xs px-3 py-1.5 text-neutral-500 hover:text-neutral-800">
              Discard
            </button>
          </div>
        </div>
      )}

      {steps.length === 0 && !suggesting && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-neutral-500">
          No job steps yet. {canSuggest ? "Let the AI draft them above, or " : ""}add them one at a time.
        </div>
      )}

      {steps.map((s, i) => (
        <StepCard
          key={s.id}
          index={i}
          step={s}
          total={steps.length}
          riskById={riskById}
          statementsByRisk={statementsByRisk}
          onChange={(fn) => update(s.id, fn)}
          onMove={(dir) => move(i, dir)}
          onRemove={() => onChange(steps.filter((x) => x.id !== s.id))}
          onOpenPicker={() => setPickerFor(s.id)}
          onToggleRisk={(riskId) => toggleRisk(s.id, riskId)}
          onToggleControl={(text, riskId) => toggleControl(s.id, text, riskId)}
        />
      ))}

      <button
        onClick={() => onChange([...steps, blankStep()])}
        className="w-full rounded-xl border border-dashed border-border py-3 text-sm text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
      >
        + Add step
      </button>

      {pickerStep && (
        <RiskPicker
          register={register}
          selected={pickerStep.riskIds}
          onToggle={(riskId) => toggleRisk(pickerStep.id, riskId)}
          onClose={() => setPickerFor(null)}
          stepLabel={`Step ${steps.indexOf(pickerStep) + 1}: ${pickerStep.description || "(no description yet)"}`}
        />
      )}
    </div>
  );
}

function StepCard({
  index,
  step,
  total,
  riskById,
  statementsByRisk,
  onChange,
  onMove,
  onRemove,
  onOpenPicker,
  onToggleRisk,
  onToggleControl,
}: {
  index: number;
  step: TaStep;
  total: number;
  riskById: Map<string, Risk>;
  statementsByRisk: Map<string, string[]>;
  onChange: (fn: (s: TaStep) => TaStep) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onOpenPicker: () => void;
  onToggleRisk: (riskId: string) => void;
  onToggleControl: (text: string, riskId: string | null) => void;
}) {
  const [newRisk, setNewRisk] = useState("");
  const [newControl, setNewControl] = useState("");
  const selectedTexts = new Set(step.controls.map((c) => c.text));
  // Decide open/closed once: risks that already have ticks (e.g. AI-drafted)
  // start collapsed to just the ticked controls; newly linked risks start open.
  // Not recomputed on every tick, so ticking one control doesn't hide the rest.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(step.riskIds.map((id) => [id, !(statementsByRisk.get(id) || []).some((t) => selectedTexts.has(t))]))
  );
  const registerTexts = new Set(step.riskIds.flatMap((id) => statementsByRisk.get(id) || []));
  const customControls: StepControl[] = step.controls.filter((c) => !registerTexts.has(c.text));

  function addIdentified() {
    const t = newRisk.trim();
    if (!t) return;
    onChange((s) => ({ ...s, identifiedRisks: [...s.identifiedRisks, t] }));
    setNewRisk("");
  }
  function addControl() {
    const t = newControl.trim();
    if (!t || selectedTexts.has(t)) return;
    onChange((s) => ({ ...s, controls: [...s.controls, { text: t, riskId: null }] }));
    setNewControl("");
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 p-4 border-b border-border">
        <span className="mt-1.5 h-6 w-6 shrink-0 rounded-full bg-neutral-100 text-xs font-semibold text-neutral-600 flex items-center justify-center">{index + 1}</span>
        <input
          value={step.description}
          onChange={(e) => onChange((s) => ({ ...s, description: e.target.value }))}
          placeholder="Describe the job step — e.g. “MEWP access to L4 southern courtyard gutter”"
          className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <div className="flex items-center gap-2 shrink-0 mt-1">
          <RatingBadge score={step.initialScore} />
          <span className="text-neutral-300 text-xs">→</span>
          <RatingBadge score={step.residualScore} />
        </div>
        <div className="flex items-center shrink-0 text-neutral-400">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="px-1.5 py-1 hover:text-neutral-800 disabled:opacity-30" aria-label="Move step up">↑</button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="px-1.5 py-1 hover:text-neutral-800 disabled:opacity-30" aria-label="Move step down">↓</button>
          <button onClick={onRemove} className="px-1.5 py-1 hover:text-red-600" aria-label="Remove step">✕</button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-0 lg:divide-x divide-border">
        {/* Left: risks */}
        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">Register risks</span>
              <button onClick={onOpenPicker} className="text-xs text-accent font-medium hover:underline">+ Link risk</button>
            </div>
            {step.riskIds.length === 0 ? (
              <button onClick={onOpenPicker} className="w-full rounded-lg border border-dashed border-border py-2 text-xs text-neutral-500 hover:bg-neutral-50">
                Link the Sansom register risks this step involves
              </button>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {step.riskIds.map((id) => {
                  const r = riskById.get(id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 rounded-md border border-border bg-neutral-50 pl-2 pr-1 py-0.5 text-xs">
                      <span className="mono-id text-neutral-400">{id}</span>
                      <span className="text-neutral-700">{r?.title ?? "(removed from register)"}</span>
                      <button onClick={() => onToggleRisk(id)} className="px-1 text-neutral-400 hover:text-red-600" aria-label={`Unlink ${id}`}>×</button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <span className="block text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-1.5">Identified risks (what could cause harm)</span>
            <ul className="space-y-1 mb-1.5">
              {step.identifiedRisks.map((r, i) => (
                <li key={`${r}-${i}`} className="flex items-center gap-2 text-sm">
                  <span className="text-neutral-300">•</span>
                  <span className="flex-1">{r}</span>
                  <button
                    onClick={() => onChange((s) => ({ ...s, identifiedRisks: s.identifiedRisks.filter((_, j) => j !== i) }))}
                    className="text-xs text-neutral-300 hover:text-red-600"
                    aria-label={`Remove ${r}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-1.5">
              <input
                value={newRisk}
                onChange={(e) => setNewRisk(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addIdentified()}
                placeholder="Add — e.g. Dropped objects"
                className="flex-1 rounded-md border border-border px-2 py-1 text-xs"
              />
              <button onClick={addIdentified} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-neutral-50">Add</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <RatingPicker
              label="Initial"
              likelihood={step.initialLikelihood}
              consequence={step.initialConsequence}
              onChange={(l, c) => onChange((s) => ({ ...s, initialLikelihood: l, initialConsequence: c }))}
            />
            <RatingPicker
              label="Residual"
              likelihood={step.residualLikelihood}
              consequence={step.residualConsequence}
              onChange={(l, c) => onChange((s) => ({ ...s, residualLikelihood: l, residualConsequence: c }))}
            />
          </div>
          {step.initialScore !== null && step.residualScore !== null && step.residualScore > step.initialScore && (
            <p className="text-xs text-red-600">Residual rating is higher than the initial rating.</p>
          )}
        </div>

        {/* Right: controls */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">Control measures in place</span>
            <span className="text-xs text-neutral-400">{step.controls.length} selected</span>
          </div>

          {step.riskIds.length === 0 && customControls.length === 0 && (
            <p className="text-xs text-neutral-400 mb-3">Link a register risk to choose from its controls, or add job-specific controls below.</p>
          )}

          <div className="space-y-3">
            {step.riskIds.map((riskId) => {
              const statements = statementsByRisk.get(riskId) || [];
              const chosen = statements.filter((t) => selectedTexts.has(t)).length;
              const open = expanded[riskId] ?? true;
              const visible = open ? statements : statements.filter((t) => selectedTexts.has(t));
              return (
                <div key={riskId} className="rounded-lg border border-border">
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [riskId]: !open }))}
                    className="w-full flex items-center justify-between px-3 py-1.5 bg-neutral-50 rounded-t-lg text-left"
                  >
                    <span className="text-xs">
                      <span className="mono-id text-neutral-400 mr-1.5">{riskId}</span>
                      <span className="font-medium text-neutral-700">{riskById.get(riskId)?.title ?? ""}</span>
                    </span>
                    <span className="text-[11px] text-neutral-500 shrink-0">
                      {chosen}/{statements.length} · {open ? "hide unticked" : "show all"}
                    </span>
                  </button>
                  {statements.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-neutral-400">No controls recorded against this risk in the register.</p>
                  ) : (
                    <ul className={`px-3 py-2 space-y-1 ${open ? "max-h-64 overflow-y-auto" : ""}`}>
                      {visible.map((t) => (
                        <li key={t}>
                          <label className="flex items-start gap-2 text-xs cursor-pointer">
                            <input type="checkbox" className="mt-0.5" checked={selectedTexts.has(t)} onChange={() => onToggleControl(t, riskId)} />
                            <span className={selectedTexts.has(t) ? "text-neutral-900" : "text-neutral-500"}>{t}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}

            <div className="rounded-lg border border-border">
              <p className="px-3 py-1.5 bg-neutral-50 rounded-t-lg text-xs font-medium text-neutral-700">Job-specific controls</p>
              <ul className="px-3 py-2 space-y-1">
                {customControls.map((c) => (
                  <li key={c.text} className="flex items-start gap-2 text-xs">
                    <span className="text-neutral-300 mt-px">•</span>
                    <span className="flex-1 text-neutral-900">{c.text}</span>
                    <button onClick={() => onToggleControl(c.text, c.riskId)} className="text-neutral-300 hover:text-red-600" aria-label="Remove control">✕</button>
                  </li>
                ))}
                {customControls.length === 0 && <li className="text-xs text-neutral-400">None yet — add anything specific to this job (products, areas, permits).</li>}
              </ul>
              <div className="flex gap-1.5 px-3 pb-2">
                <input
                  value={newControl}
                  onChange={(e) => setNewControl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addControl()}
                  placeholder="e.g. Hot Work Permit issued before torching membrane at L4 gutter"
                  className="flex-1 rounded-md border border-border px-2 py-1 text-xs"
                />
                <button onClick={addControl} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-neutral-50">Add</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
