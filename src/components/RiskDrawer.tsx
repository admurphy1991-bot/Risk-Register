"use client";

import { useEffect, useState } from "react";
import type { Risk } from "@/lib/types";
import {
  LIKELIHOOD_LABELS,
  CONSEQUENCE_LABELS,
  computeScore,
  scoreLevel,
  LEVEL_COLORS,
  STATUS_OPTIONS,
} from "@/lib/risk-scoring";

type Meta = { categories: { id: string; name: string }[]; locations: { id: string; name: string }[] };

export default function RiskDrawer({
  risk,
  meta,
  onClose,
  onSaved,
  onDeleted,
}: {
  risk: Risk | null; // null = create mode
  meta: Meta;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState(() => ({
    title: risk?.title ?? "",
    description: risk?.description ?? "",
    category: risk?.category ?? meta.categories[0]?.name ?? "",
    location: risk?.location ?? meta.locations[0]?.name ?? "",
    ownerName: risk?.ownerName ?? "",
    status: risk?.status ?? "Draft",
    nextReviewDate: risk?.nextReviewDate ?? "",
    inherentLikelihood: risk?.inherentLikelihood ?? null,
    inherentConsequence: risk?.inherentConsequence ?? null,
    residualLikelihood: risk?.residualLikelihood ?? null,
    residualConsequence: risk?.residualConsequence ?? null,
  }));
  const [controls, setControls] = useState(risk?.controls ?? []);
  const [newControl, setNewControl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const inherentScore = computeScore(form.inherentLikelihood, form.inherentConsequence);
  const residualScore = computeScore(form.residualLikelihood, form.residualConsequence);
  const inherentLevel = scoreLevel(inherentScore);
  const residualLevel = scoreLevel(residualScore);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form, nextReviewDate: form.nextReviewDate || null };
      const res = risk
        ? await fetch(`/api/risks/${risk.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/risks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addControl() {
    if (!risk || !newControl.trim()) return;
    const res = await fetch("/api/controls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ riskId: risk.id, description: newControl.trim() }),
    });
    const data = await res.json();
    if (res.ok) {
      setControls((c) => [...c, data.control]);
      setNewControl("");
    }
  }

  async function toggleControl(id: string, implemented: boolean) {
    const res = await fetch(`/api/controls/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ implemented }),
    });
    if (res.ok) {
      setControls((c) => c.map((ctrl) => (ctrl.id === id ? { ...ctrl, implemented } : ctrl)));
    }
  }

  async function removeControl(id: string) {
    const res = await fetch(`/api/controls/${id}`, { method: "DELETE" });
    if (res.ok) setControls((c) => c.filter((ctrl) => ctrl.id !== id));
  }

  async function deleteRisk() {
    if (!risk) return;
    if (!confirm(`Delete ${risk.id}? This can be undone from Settings > Activity.`)) return;
    const res = await fetch(`/api/risks/${risk.id}`, { method: "DELETE" });
    if (res.ok) onDeleted();
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-card border-l border-border flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 h-14 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {risk && <span className="mono-id text-neutral-400">{risk.id}</span>}
            <span className="font-medium text-sm">{risk ? "Edit risk" : "Add risk"}</span>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 text-lg leading-none">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">Title</label>
            <input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="e.g. Forklift and pedestrian interaction"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">Category</label>
              <input
                list="categories"
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              <datalist id="categories">
                {meta.categories.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">Location</label>
              <input
                list="locations"
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              <datalist id="locations">
                {meta.locations.map((l) => (
                  <option key={l.id} value={l.name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">Owner</label>
              <input
                value={form.ownerName}
                onChange={(e) => set("ownerName", e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1">Next review</label>
              <input
                type="date"
                value={form.nextReviewDate ?? ""}
                onChange={(e) => set("nextReviewDate", e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </div>

          {[
            { label: "Inherent", lk: "inherentLikelihood", cq: "inherentConsequence", score: inherentScore, level: inherentLevel },
            { label: "Residual", lk: "residualLikelihood", cq: "residualConsequence", score: residualScore, level: residualLevel },
          ].map((block) => (
            <div key={block.label} className="border border-border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-neutral-500">{block.label} risk rating</span>
                {block.level && (
                  <span className={`text-[11px] px-1.5 py-0.5 rounded border font-medium ${LEVEL_COLORS[block.level]}`}>
                    {block.level} · {block.score}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-neutral-500 mb-1">Likelihood</label>
                  <select
                    value={(form as never as Record<string, number | null>)[block.lk] ?? ""}
                    onChange={(e) => set(block.lk as keyof typeof form, (e.target.value ? Number(e.target.value) : null) as never)}
                    className="w-full rounded-lg border border-border px-2 py-1.5 text-sm"
                  >
                    <option value="">—</option>
                    {LIKELIHOOD_LABELS.map((l, i) => (
                      <option key={l} value={i + 1}>
                        {i + 1} · {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-neutral-500 mb-1">Consequence</label>
                  <select
                    value={(form as never as Record<string, number | null>)[block.cq] ?? ""}
                    onChange={(e) => set(block.cq as keyof typeof form, (e.target.value ? Number(e.target.value) : null) as never)}
                    className="w-full rounded-lg border border-border px-2 py-1.5 text-sm"
                  >
                    <option value="">—</option>
                    {CONSEQUENCE_LABELS.map((l, i) => (
                      <option key={l} value={i + 1}>
                        {i + 1} · {l}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}

          {risk && (
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-2">Controls</label>
              <ul className="space-y-1.5 mb-2">
                {controls.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm border border-border rounded-lg px-2.5 py-1.5">
                    <input
                      type="checkbox"
                      checked={c.implemented}
                      onChange={(e) => toggleControl(c.id, e.target.checked)}
                    />
                    <span className={`flex-1 ${c.implemented ? "" : "text-neutral-500"}`}>{c.description}</span>
                    <button onClick={() => removeControl(c.id)} className="text-neutral-300 hover:text-red-500 text-xs">
                      Remove
                    </button>
                  </li>
                ))}
                {controls.length === 0 && <p className="text-xs text-neutral-400">No controls recorded yet.</p>}
              </ul>
              <div className="flex gap-2">
                <input
                  value={newControl}
                  onChange={(e) => setNewControl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addControl()}
                  placeholder="Add a control…"
                  className="flex-1 rounded-lg border border-border px-2.5 py-1.5 text-sm"
                />
                <button onClick={addControl} className="rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-neutral-50">
                  Add
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="border-t border-border p-4 flex items-center justify-between shrink-0">
          {risk ? (
            <button onClick={deleteRisk} className="text-sm text-red-600 hover:underline">
              Delete risk
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-3.5 py-2 text-sm hover:bg-neutral-50">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-accent text-white px-3.5 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : risk ? "Save changes" : "Create risk"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
