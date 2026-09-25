import { db, schema, sqlite } from "@/lib/db";
import { eq, desc, inArray } from "drizzle-orm";
import { uid } from "@/lib/ids";
import { computeScore } from "@/lib/risk-scoring";
import type { SessionUser } from "@/lib/auth";

// Domain logic for Task Analyses (TA / SWMS): defaults taken from Sansom's
// own template, loading/saving, status transitions and the event timeline.

export * from "@/lib/ta-shared";
import {
  DEFAULT_LEGISLATION,
  DEFAULT_RESPONSIBLE_COMPLIANCE,
  DEFAULT_REVIEW_FREQUENCY,
  type PlantItem,
  type ChemicalItem,
  type StepControl,
  type TaStep,
  type TaStatus,
  type TaFull,
} from "@/lib/ta-shared";

// Header fields a client may PATCH. Array fields are stored as JSON.
const TEXT_FIELDS = [
  "jobNumber",
  "projectName",
  "taDate",
  "siteAddress",
  "mainContractor",
  "siteContactName",
  "siteContactPhone",
  "contractManager",
  "contractManagerPhone",
  "workType",
  "overview",
  "responsibleCompliance",
  "responsibleReview",
  "reviewFrequency",
  "preparedByName",
] as const;
const ARRAY_FIELDS = ["permits", "legislation", "plant", "chemicals", "ppe"] as const;

export type TaHeaderPatch = Partial<Record<(typeof TEXT_FIELDS)[number], string | null>> &
  Partial<{
    permits: string[];
    legislation: string[];
    plant: PlantItem[];
    chemicals: ChemicalItem[];
    ppe: string[];
  }>;

type TaRow = typeof schema.taskAnalyses.$inferSelect;

function parse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function now() {
  return new Date().toISOString();
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function mapTaRow(row: TaRow) {
  return {
    ...row,
    status: row.status as TaStatus,
    permits: parse<string[]>(row.permits, []),
    legislation: parse<string[]>(row.legislation, []),
    plant: parse<PlantItem[]>(row.plant, []),
    chemicals: parse<ChemicalItem[]>(row.chemicals, []),
    ppe: parse<string[]>(row.ppe, []),
    aiFilledFields: parse<string[]>(row.aiFilledFields, []),
  };
}

export type TaHeader = ReturnType<typeof mapTaRow>;

export async function nextTaId(): Promise<string> {
  const rows = await db.select({ id: schema.taskAnalyses.id }).from(schema.taskAnalyses);
  let max = 0;
  for (const r of rows) {
    const m = /^TA-(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `TA-${String(max + 1).padStart(4, "0")}`;
}

export async function logTaEvent(taId: string, type: string, actorName: string, detail?: string | null) {
  await db.insert(schema.taEvents).values({
    id: uid("tev"),
    taId,
    type,
    actorName,
    detail: detail ?? null,
    createdAt: now(),
  });
}

export async function createTa(user: SessionUser) {
  const id = await nextTaId();
  const ts = now();
  await db.insert(schema.taskAnalyses).values({
    id,
    taDate: todayIso(),
    legislation: JSON.stringify(DEFAULT_LEGISLATION),
    responsibleCompliance: DEFAULT_RESPONSIBLE_COMPLIANCE,
    reviewFrequency: DEFAULT_REVIEW_FREQUENCY,
    responsibleReview: `${user.name} / Supervisor / H&S Team`,
    contractManager: user.name,
    status: "draft",
    preparedById: user.id,
    preparedByName: user.name,
    createdAt: ts,
    updatedAt: ts,
  });
  await logTaEvent(id, "created", user.name);
  return id;
}

export async function getTaHeader(id: string): Promise<TaHeader | null> {
  const rows = await db.select().from(schema.taskAnalyses).where(eq(schema.taskAnalyses.id, id)).limit(1);
  return rows[0] ? mapTaRow(rows[0]) : null;
}

export async function getTaSteps(taId: string): Promise<TaStep[]> {
  const steps = await db.select().from(schema.taSteps).where(eq(schema.taSteps.taId, taId));
  const links = await db.select().from(schema.taStepRisks).where(eq(schema.taStepRisks.taId, taId));
  const riskIdsByStep: Record<string, string[]> = {};
  for (const l of links) (riskIdsByStep[l.stepId] ||= []).push(l.riskId);
  return steps
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({
      id: s.id,
      description: s.description,
      identifiedRisks: parse<string[]>(s.identifiedRisks, []),
      riskIds: riskIdsByStep[s.id] || [],
      controls: parse<StepControl[]>(s.controls, []),
      initialLikelihood: s.initialLikelihood,
      initialConsequence: s.initialConsequence,
      initialScore: s.initialScore,
      residualLikelihood: s.residualLikelihood,
      residualConsequence: s.residualConsequence,
      residualScore: s.residualScore,
    }));
}

export async function getTaFull(id: string): Promise<TaFull | null> {
  const header = await getTaHeader(id);
  if (!header) return null;
  const [steps, files, events, deliveries] = await Promise.all([
    getTaSteps(id),
    db.select().from(schema.taFiles).where(eq(schema.taFiles.taId, id)),
    db.select().from(schema.taEvents).where(eq(schema.taEvents.taId, id)).orderBy(desc(schema.taEvents.createdAt)),
    db
      .select()
      .from(schema.outboundDeliveries)
      .where(eq(schema.outboundDeliveries.taId, id))
      .orderBy(desc(schema.outboundDeliveries.createdAt)),
  ]);
  return {
    ...header,
    steps,
    files: files.map((f) => ({
      id: f.id,
      filename: f.filename,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      createdAt: f.createdAt,
      hasText: !!f.extractedText,
    })),
    events,
    deliveries,
  };
}


export async function listTas() {
  const rows = await db.select().from(schema.taskAnalyses).orderBy(desc(schema.taskAnalyses.updatedAt));
  const steps = await db.select().from(schema.taSteps);
  const links = await db.select().from(schema.taStepRisks);
  const byTa: Record<string, { steps: number; maxInitial: number | null; maxResidual: number | null }> = {};
  for (const s of steps) {
    const agg = (byTa[s.taId] ||= { steps: 0, maxInitial: null, maxResidual: null });
    agg.steps++;
    if (s.initialScore !== null) agg.maxInitial = Math.max(agg.maxInitial ?? 0, s.initialScore);
    if (s.residualScore !== null) agg.maxResidual = Math.max(agg.maxResidual ?? 0, s.residualScore);
  }
  const risksByTa: Record<string, Set<string>> = {};
  for (const l of links) (risksByTa[l.taId] ||= new Set()).add(l.riskId);
  return rows.map((r) => {
    const h = mapTaRow(r);
    return {
      id: h.id,
      jobNumber: h.jobNumber,
      projectName: h.projectName,
      siteAddress: h.siteAddress,
      taDate: h.taDate,
      status: h.status,
      preparedByName: h.preparedByName,
      updatedAt: h.updatedAt,
      submittedAt: h.submittedAt,
      stepCount: byTa[h.id]?.steps ?? 0,
      riskCount: risksByTa[h.id]?.size ?? 0,
      maxInitialScore: byTa[h.id]?.maxInitial ?? null,
      maxResidualScore: byTa[h.id]?.maxResidual ?? null,
    };
  });
}

export async function updateTaHeader(id: string, patch: TaHeaderPatch, opts?: { aiFilled?: string[] }) {
  const set: Record<string, unknown> = { updatedAt: now() };
  for (const key of TEXT_FIELDS) {
    if (key in patch) {
      const v = patch[key];
      set[key] = key === "taDate" ? (v || null) : (v ?? "").toString();
    }
  }
  for (const key of ARRAY_FIELDS) {
    if (key in patch && Array.isArray(patch[key])) {
      set[key] = JSON.stringify(patch[key]);
    }
  }
  if (opts?.aiFilled) {
    const current = await getTaHeader(id);
    const merged = new Set([...(current?.aiFilledFields || []), ...opts.aiFilled]);
    set.aiFilledFields = JSON.stringify([...merged]);
  } else {
    // A person edited these fields — they're no longer "AI-filled".
    const current = await getTaHeader(id);
    const touched = Object.keys(patch);
    const remaining = (current?.aiFilledFields || []).filter((f) => !touched.includes(f));
    set.aiFilledFields = JSON.stringify(remaining);
  }
  await db.update(schema.taskAnalyses).set(set).where(eq(schema.taskAnalyses.id, id));
}

export type StepInput = Omit<TaStep, "id" | "initialScore" | "residualScore"> & { id?: string };

function clampRating(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function cleanStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => String(s ?? "").trim()).filter(Boolean);
}

/** Replaces all steps (and their register-risk links) for a TA atomically. */
export function saveSteps(taId: string, steps: StepInput[], validRiskIds: Set<string>) {
  const ts = now();
  const insertStep = sqlite.prepare(
    `INSERT INTO ta_steps (id, ta_id, sort_order, description, identified_risks, controls,
      initial_likelihood, initial_consequence, initial_score,
      residual_likelihood, residual_consequence, residual_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertLink = sqlite.prepare(`INSERT INTO ta_step_risks (id, ta_id, step_id, risk_id) VALUES (?, ?, ?, ?)`);

  const tx = sqlite.transaction(() => {
    sqlite.prepare(`DELETE FROM ta_step_risks WHERE ta_id = ?`).run(taId);
    sqlite.prepare(`DELETE FROM ta_steps WHERE ta_id = ?`).run(taId);
    steps.forEach((s, i) => {
      const stepId = s.id && /^tst_/.test(s.id) ? s.id : uid("tst");
      const il = clampRating(s.initialLikelihood);
      const ic = clampRating(s.initialConsequence);
      const rl = clampRating(s.residualLikelihood);
      const rc = clampRating(s.residualConsequence);
      const controls = (Array.isArray(s.controls) ? s.controls : [])
        .map((c) => ({ text: String(c?.text ?? "").trim(), riskId: c?.riskId && validRiskIds.has(c.riskId) ? c.riskId : null }))
        .filter((c) => c.text);
      insertStep.run(
        stepId,
        taId,
        i,
        String(s.description ?? "").trim(),
        JSON.stringify(cleanStrings(s.identifiedRisks)),
        JSON.stringify(controls),
        il,
        ic,
        computeScore(il, ic),
        rl,
        rc,
        computeScore(rl, rc)
      );
      const riskIds = [...new Set(cleanStrings(s.riskIds))].filter((r) => validRiskIds.has(r));
      for (const riskId of riskIds) insertLink.run(uid("tsr"), taId, stepId, riskId);
    });
    sqlite.prepare(`UPDATE task_analyses SET updated_at = ? WHERE id = ?`).run(ts, taId);
  });
  tx();
}

export async function setTaStatus(
  id: string,
  status: TaStatus,
  extra: Partial<Pick<TaRow, "submittedAt" | "reviewedAt" | "reviewedByName" | "reviewComment">> = {}
) {
  await db
    .update(schema.taskAnalyses)
    .set({ status, updatedAt: now(), ...extra })
    .where(eq(schema.taskAnalyses.id, id));
}

export async function deleteTa(id: string) {
  const tx = sqlite.transaction(() => {
    for (const table of ["ta_step_risks", "ta_steps", "ta_files", "ta_events"]) {
      sqlite.prepare(`DELETE FROM ${table} WHERE ta_id = ?`).run(id);
    }
    sqlite.prepare(`DELETE FROM task_analyses WHERE id = ?`).run(id);
  });
  tx();
}

/** Register risks keyed by id, for validating/labelling step links. */
export async function getRegisterRiskMap(ids?: string[]) {
  const rows = ids?.length
    ? await db.select().from(schema.risks).where(inArray(schema.risks.id, ids))
    : await db.select().from(schema.risks);
  return new Map(rows.map((r) => [r.id, r]));
}
