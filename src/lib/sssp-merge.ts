import type { SsspDraft } from "@/lib/sssp-ai";
import { DEFAULT_ERP_RESCUE, defaultSsspData, type SsspData, type SsspPatch } from "@/lib/sssp-shared";
import type { SsspHeader } from "@/lib/sssp";

// Merges an AI draft into an SSSP without overwriting anything a person
// typed: a field is filled when it's empty, still at its template default,
// or was filled by the AI last time. Lists a person (or the linked TA) has
// started get the AI's extra suggestions added, never removed.

export type MergeResult = {
  patch: SsspPatch;
  aiKeys: string[]; // fields now owned by the AI (badged ✦ AI)
  filled: string[]; // human-readable summary of what changed
  kept: { key: string; label: string; value: unknown }[]; // AI disagreed with a human value
};

const LABELS: Record<string, string> = {
  jobNumber: "Job number",
  projectName: "Project name",
  siteAddress: "Site location",
  mainContractor: "Main contractor",
  clientContactName: "Client contact",
  clientContactPhone: "Client phone",
  projectManager: "Sansom project manager",
  projectManagerPhone: "PM phone",
  startDate: "Start date",
  endDate: "End date",
  scope: "Scope of works",
  subcontractedWorks: "Sub-contracted works",
  notifiableOther: "Other notifiable work",
};

export function mergeDraft(s: SsspHeader, draft: SsspDraft): MergeResult {
  const ai = new Set(s.aiFilledFields);
  const defaults = defaultSsspData();
  const patch: SsspPatch = {};
  const data: Partial<SsspData> = {};
  const aiKeys: string[] = [];
  const filled: string[] = [];
  let answerCount = 0;
  const kept: MergeResult["kept"] = [];

  const consider = (key: string, current: string | null | undefined, value: string | undefined, replaceable = false, label = LABELS[key] ?? key) => {
    const v = (value ?? "").trim();
    if (!v) return false;
    const cur = (current ?? "").trim();
    if (!cur || ai.has(key) || replaceable) {
      if (cur !== v) filled.push(label);
      aiKeys.push(key);
      return true;
    }
    if (cur !== v) kept.push({ key, label, value: v });
    return false;
  };

  for (const k of ["jobNumber", "projectName", "siteAddress", "mainContractor"] as const) {
    if (consider(k, s[k], draft[k])) patch[k] = draft[k]!.trim();
  }
  const d = s.data;
  for (const k of ["clientContactName", "clientContactPhone", "projectManagerPhone", "scope", "subcontractedWorks", "notifiableOther"] as const) {
    if (consider(k, d[k], draft[k])) data[k] = draft[k]!.trim();
  }
  if (consider("projectManager", d.projectManager, draft.projectManager, d.projectManager === s.preparedByName)) data.projectManager = draft.projectManager!.trim();
  for (const k of ["startDate", "endDate"] as const) if (consider(k, d[k], draft[k])) data[k] = draft[k]!;

  // YES / N/A decisions
  const answers: SsspData["answers"] = {};
  for (const [id, v] of Object.entries(draft.answers || {})) {
    const key = `answers.${id}`;
    const cur = d.answers[id];
    if (!cur || ai.has(key)) {
      answers[id] = v;
      aiKeys.push(key);
      if (cur !== v) answerCount++;
    } else if (cur !== v) kept.push({ key, label: `Answer "${id.replace(/_/g, " ")}"`, value: v });
  }
  if (Object.keys(answers).length) data.answers = answers;

  // Environmental controls
  const controls: Partial<SsspData["controls"]> = {};
  for (const k of ["dust", "noise", "water"] as const) {
    if (consider(`controls.${k}`, d.controls[k], draft.controls?.[k], d.controls[k] === defaults.controls[k], `controls: ${k}`)) controls[k] = draft.controls![k]!.trim();
  }
  if (Object.keys(controls).length) data.controls = controls as SsspData["controls"];

  // Emergency plan and contacts
  const emergency: Partial<SsspData["emergency"]> = {};
  for (const [k, v] of Object.entries(draft.emergency || {}) as [keyof SsspData["emergency"], string][]) {
    const isDefault = d.emergency[k] === defaults.emergency[k] || (k === "rescueMethod" && d.emergency[k] === DEFAULT_ERP_RESCUE);
    if (consider(`emergency.${k}`, d.emergency[k], v, isDefault, `Emergency: ${k}`)) emergency[k] = v.trim();
  }
  // Don't pair a new hospital with the old hospital's number.
  if (emergency.hospital && !emergency.hospitalPhone && d.emergency.hospitalPhone === defaults.emergency.hospitalPhone && emergency.hospital !== defaults.emergency.hospital) {
    emergency.hospitalPhone = "";
  }
  if (Object.keys(emergency).length) data.emergency = emergency as SsspData["emergency"];
  const contacts: Partial<SsspData["contacts"]> = {};
  for (const [k, v] of Object.entries(draft.contacts || {}) as [keyof SsspData["contacts"], string][]) {
    if (consider(`contacts.${k}`, d.contacts[k], v, false, `Contact: ${k}`)) contacts[k] = v.trim();
  }
  if (Object.keys(contacts).length) data.contacts = contacts as SsspData["contacts"];

  // Lists
  const list = (key: "workTypes" | "notifiableWorks", proposed: string[] | undefined, label: string) => {
    if (!proposed?.length) return;
    if (!d[key].length || ai.has(key)) {
      data[key] = proposed;
      aiKeys.push(key);
      filled.push(label);
    } else {
      const extra = proposed.filter((p) => !d[key].includes(p));
      if (extra.length) {
        data[key] = [...d[key], ...extra];
        filled.push(`${label} (+${extra.length})`);
      }
    }
  };
  list("workTypes", draft.workTypes, "Work types");
  list("notifiableWorks", draft.notifiableWorks, "Notifiable works");

  const picks = (key: "riskIds" | "chemicalIds", reasonKey: "riskReasons" | "chemicalReasons", proposed: { id: string; reason?: string }[] | undefined, label: string) => {
    if (!proposed?.length) return;
    const reasons = { ...d[reasonKey] };
    for (const p of proposed) if (p.reason && (!reasons[p.id] || ai.has(key))) reasons[p.id] = `✦ ${p.reason}`;
    if (!d[key].length || ai.has(key)) {
      data[key] = proposed.map((p) => p.id);
      aiKeys.push(key);
      filled.push(`${label} (${proposed.length})`);
    } else {
      const extra = proposed.filter((p) => !d[key].includes(p.id)).map((p) => p.id);
      if (extra.length) {
        data[key] = [...d[key], ...extra];
        filled.push(`${label} (+${extra.length})`);
      }
    }
    data[reasonKey] = reasons;
  };
  picks("riskIds", "riskReasons", draft.risks, "Site risks");
  picks("chemicalIds", "chemicalReasons", draft.chemicals, "Hazardous substances");

  if (draft.unmatchedProducts?.length) {
    const merged = [...new Set([...d.unmatchedProducts, ...draft.unmatchedProducts])];
    if (merged.length !== d.unmatchedProducts.length) data.unmatchedProducts = merged;
  }
  data.aiNotes = (draft.notes || "").trim();

  // Collapse the per-field entries into a readable summary.
  const grouped = (prefix: string) => filled.filter((f) => f.startsWith(prefix)).length;
  const nControls = grouped("controls:"), nEmergency = grouped("Emergency:"), nContacts = grouped("Contact:");
  const summary = filled.filter((f) => !/^(controls:|Emergency:|Contact:)/.test(f));
  if (answerCount) summary.push(`${answerCount} YES/N/A answer${answerCount === 1 ? "" : "s"}`);
  if (nControls) summary.push(`${nControls} environmental control${nControls === 1 ? "" : "s"}`);
  if (nEmergency) summary.push("Emergency plan");
  if (nContacts) summary.push(`${nContacts} contact detail${nContacts === 1 ? "" : "s"}`);
  filled.splice(0, filled.length, ...summary);

  patch.data = data;
  return { patch, aiKeys, filled, kept };
}
