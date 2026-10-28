import { desc, eq, inArray } from "drizzle-orm";
import { db, schema, sqlite } from "@/lib/db";
import { uid } from "@/lib/ids";
import type { SessionUser } from "@/lib/auth";
import { getTaFull, todayIso } from "@/lib/ta";
import { listChemicals, productKey } from "@/lib/chemicals";
import {
  HEADER_FIELDS,
  normaliseSsspData,
  defaultSsspData,
  type SsspData,
  type SsspFull,
  type SsspPatch,
  type SsspStatus,
} from "@/lib/sssp-shared";

export * from "@/lib/sssp-shared";

// SSSP storage. Supporting documents and the timeline share the TA tables
// (ta_files / ta_events), keyed by the SSSP id.

type Row = typeof schema.sssps.$inferSelect;

function parse<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

const now = () => new Date().toISOString();

function mapRow(r: Row) {
  return {
    id: r.id,
    jobNumber: r.jobNumber,
    projectName: r.projectName,
    siteAddress: r.siteAddress,
    mainContractor: r.mainContractor,
    data: normaliseSsspData(parse(r.data, {})),
    status: r.status as SsspStatus,
    preparedById: r.preparedById,
    preparedByName: r.preparedByName,
    aiFilledFields: parse<string[]>(r.aiFilledFields, []),
    submittedAt: r.submittedAt,
    reviewedAt: r.reviewedAt,
    reviewedByName: r.reviewedByName,
    reviewComment: r.reviewComment,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export type SsspHeader = ReturnType<typeof mapRow>;

export async function nextSsspId() {
  const rows = await db.select({ id: schema.sssps.id }).from(schema.sssps);
  let max = 0;
  for (const r of rows) {
    const m = /^SSSP-(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `SSSP-${String(max + 1).padStart(4, "0")}`;
}

export async function logSsspEvent(id: string, type: string, actorName: string, detail?: string | null) {
  await db.insert(schema.taEvents).values({ id: uid("tev"), taId: id, type, actorName, detail: detail ?? null, createdAt: now() });
}

const MEWP_RE = /mewp|scissor|boom lift|vertical lifter|cherry picker|elevated work platform|swing stage|knuckle/i;

/** Matches product names (e.g. from a TA) to chemical register entries. */
export async function matchProducts(names: string[]) {
  const register = (await listChemicals()).filter((c) => c.status !== "No Longer in Use");
  const byKey = new Map(register.map((c) => [productKey(c.productName), c.id]));
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const n of names) {
    const k = productKey(n);
    if (!k) continue;
    const exact = byKey.get(k);
    const partial = exact ?? register.find((c) => {
      const ck = productKey(c.productName);
      return ck.length > 5 && (ck.includes(k) || k.includes(ck));
    })?.id;
    if (partial) {
      if (!matched.includes(partial)) matched.push(partial);
    } else unmatched.push(n);
  }
  return { matched, unmatched };
}

export async function createSssp(user: SessionUser, opts: { fromTaId?: string } = {}) {
  const id = await nextSsspId();
  const ts = now();
  const data: SsspData = { ...defaultSsspData(), ssspDate: todayIso(), projectManager: user.name };
  const header = { jobNumber: "", projectName: "", siteAddress: "", mainContractor: "" };

  if (opts.fromTaId) {
    const ta = await getTaFull(opts.fromTaId);
    if (ta) {
      header.jobNumber = ta.jobNumber;
      header.projectName = ta.projectName;
      header.siteAddress = ta.siteAddress;
      header.mainContractor = ta.mainContractor;
      data.clientContactName = ta.siteContactName;
      data.clientContactPhone = ta.siteContactPhone;
      data.projectManager = ta.contractManager || user.name;
      data.projectManagerPhone = ta.contractManagerPhone;
      data.scope = ta.overview;
      data.startDate = ta.taDate;
      data.riskIds = [...new Set(ta.steps.flatMap((s) => s.riskIds))];
      for (const r of data.riskIds) data.riskReasons[r] = `Used in ${ta.id}`;
      const { matched, unmatched } = await matchProducts(ta.chemicals.map((c) => c.name));
      data.chemicalIds = matched;
      for (const c of matched) data.chemicalReasons[c] = `Listed in ${ta.id}`;
      data.unmatchedProducts = unmatched;
      data.taIds = [ta.id];
      data.answers.ta_copies = "yes";
      if (ta.chemicals.length) {
        data.answers.hazardous_products = "yes";
        data.answers.hazardous_recorded = "yes";
        data.answers.sds_provided = "yes";
      }
      if (ta.plant.some((p) => MEWP_RE.test(p.item))) data.answers.insp_mewp = "daily";
      if (ta.ppe.includes("harness")) data.answers.insp_harness = "daily";
    }
  }

  await db.insert(schema.sssps).values({
    id,
    ...header,
    data: JSON.stringify(data),
    status: "draft",
    preparedById: user.id,
    preparedByName: user.name,
    createdAt: ts,
    updatedAt: ts,
  });
  await logSsspEvent(id, "created", user.name, opts.fromTaId ? `Started from ${opts.fromTaId}` : null);
  return id;
}

export async function getSsspHeader(id: string): Promise<SsspHeader | null> {
  const rows = await db.select().from(schema.sssps).where(eq(schema.sssps.id, id)).limit(1);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getSsspFull(id: string): Promise<SsspFull | null> {
  const h = await getSsspHeader(id);
  if (!h) return null;
  const [files, events] = await Promise.all([
    db.select().from(schema.taFiles).where(eq(schema.taFiles.taId, id)),
    db.select().from(schema.taEvents).where(eq(schema.taEvents.taId, id)).orderBy(desc(schema.taEvents.createdAt)),
  ]);
  return {
    ...h,
    files: files.map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, createdAt: f.createdAt, hasText: !!f.extractedText })),
    events,
  };
}

export async function listSssps() {
  const rows = await db.select().from(schema.sssps).orderBy(desc(schema.sssps.updatedAt));
  return rows.map((r) => {
    const h = mapRow(r);
    return {
      id: h.id,
      jobNumber: h.jobNumber,
      projectName: h.projectName,
      siteAddress: h.siteAddress,
      mainContractor: h.mainContractor,
      status: h.status,
      preparedByName: h.preparedByName,
      updatedAt: h.updatedAt,
      riskCount: h.data.riskIds.length,
      chemicalCount: h.data.chemicalIds.length,
      taIds: h.data.taIds,
      startDate: h.data.startDate,
    };
  });
}

// Nested objects whose keys are tracked individually for "AI-filled" badges.
const NESTED = ["answers", "controls", "emergency", "contacts"] as const;

/** Every field key a patch touches, e.g. "projectName", "scope", "answers.env_dust". */
export function touchedKeys(patch: SsspPatch): string[] {
  const keys: string[] = HEADER_FIELDS.filter((k) => k in patch);
  for (const [k, v] of Object.entries(patch.data || {})) {
    if ((NESTED as readonly string[]).includes(k) && v && typeof v === "object") {
      for (const sub of Object.keys(v)) keys.push(`${k}.${sub}`);
    } else keys.push(k);
  }
  return keys;
}

export async function updateSssp(id: string, patch: SsspPatch, opts: { aiFilled?: string[] } = {}) {
  const current = await getSsspHeader(id);
  if (!current) throw new Error("SSSP not found");
  const set: Record<string, unknown> = { updatedAt: now() };
  for (const k of HEADER_FIELDS) if (typeof patch[k] === "string") set[k] = patch[k]!.toString();

  if (patch.data && typeof patch.data === "object") {
    const merged: SsspData = { ...current.data };
    for (const [k, v] of Object.entries(patch.data) as [keyof SsspData, unknown][]) {
      if ((NESTED as readonly string[]).includes(k) && v && typeof v === "object") {
        (merged as Record<string, unknown>)[k] = { ...(current.data[k] as object), ...(v as object) };
      } else if (k in merged) {
        (merged as Record<string, unknown>)[k] = v;
      }
    }
    set.data = JSON.stringify(normaliseSsspData(merged));
  }

  const touched = touchedKeys(patch);
  const ai = new Set(current.aiFilledFields);
  if (opts.aiFilled) opts.aiFilled.forEach((k) => ai.add(k));
  else touched.forEach((k) => ai.delete(k)); // a person edited these
  set.aiFilledFields = JSON.stringify([...ai]);

  await db.update(schema.sssps).set(set).where(eq(schema.sssps.id, id));
}

export async function setSsspStatus(
  id: string,
  status: SsspStatus,
  extra: Partial<Pick<Row, "submittedAt" | "reviewedAt" | "reviewedByName" | "reviewComment">> = {}
) {
  await db.update(schema.sssps).set({ status, updatedAt: now(), ...extra }).where(eq(schema.sssps.id, id));
}

export function deleteSssp(id: string) {
  sqlite.transaction(() => {
    sqlite.prepare(`DELETE FROM ta_files WHERE ta_id = ?`).run(id);
    sqlite.prepare(`DELETE FROM ta_events WHERE ta_id = ?`).run(id);
    sqlite.prepare(`DELETE FROM sssps WHERE id = ?`).run(id);
  })();
}

/** Register risks for an SSSP, in register order (TAC-1, TAC-2…). */
export async function getRisksForSssp(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.select().from(schema.risks).where(inArray(schema.risks.id, ids));
  const controls = await db.select().from(schema.controls).where(inArray(schema.controls.riskId, ids));
  const prefixRank = (id: string) => (id.startsWith("TAC") ? 0 : id.startsWith("PRO") ? 1 : 2);
  return rows
    .sort((a, b) => prefixRank(a.id) - prefixRank(b.id) || a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map((r) => ({ ...r, controls: controls.filter((c) => c.riskId === r.id) }));
}
