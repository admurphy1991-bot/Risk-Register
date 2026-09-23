import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { uid, nextRiskId } from "@/lib/ids";
import { computeScore } from "@/lib/risk-scoring";

// Everything that mutates risk data — the UI, the AI chat agent, and the
// public API — funnels through this module so every write is captured as a
// reviewable, reversible "change plan". This mirrors the vendor's
// plan -> apply -> undo pattern from the reference screenshots: a plan can
// be *proposed* (diff computed, nothing written yet), then *applied*
// (written) or discarded, and any applied plan can be *undone*.

export type RiskInput = {
  id?: string;
  title?: string;
  description?: string;
  category?: string;
  location?: string;
  ownerName?: string;
  inherentLikelihood?: number | null;
  inherentConsequence?: number | null;
  residualLikelihood?: number | null;
  residualConsequence?: number | null;
  status?: string;
  nextReviewDate?: string | null;
};

export type ControlInput = {
  id?: string;
  riskId?: string;
  description?: string;
  type?: string;
  implemented?: boolean;
};

export type ChangeOpInput =
  | { op: "create_risk"; data: RiskInput }
  | { op: "update_risk"; id: string; data: RiskInput }
  | { op: "delete_risk"; id: string }
  | { op: "create_control"; data: ControlInput }
  | { op: "update_control"; id: string; data: ControlInput }
  | { op: "delete_control"; id: string };

export type ComputedOp = {
  op: string;
  entityType: "risk" | "control";
  entityId: string;
  before: unknown;
  after: unknown;
};

function now() {
  return new Date().toISOString();
}

async function getRisk(id: string) {
  const rows = await db.select().from(schema.risks).where(eq(schema.risks.id, id)).limit(1);
  return rows[0] ?? null;
}

async function getControl(id: string) {
  const rows = await db.select().from(schema.controls).where(eq(schema.controls.id, id)).limit(1);
  return rows[0] ?? null;
}

async function allRiskIds(): Promise<string[]> {
  const rows = await db.select({ id: schema.risks.id }).from(schema.risks);
  return rows.map((r) => r.id);
}

/**
 * Computes the before/after snapshot for a batch of changes WITHOUT writing
 * anything. Used both to preview an AI-proposed plan and, immediately
 * followed by writeOps(), to apply changes right away for direct UI edits.
 */
async function computeOps(actorType: string, changes: ChangeOpInput[]): Promise<ComputedOp[]> {
  const computed: ComputedOp[] = [];
  const existingIds = await allRiskIds();

  for (const change of changes) {
    if (change.op === "create_risk") {
      const id =
        change.data.id ||
        nextRiskId([...existingIds, ...computed.filter((a) => a.entityType === "risk").map((a) => a.entityId)]);
      const inh = computeScore(change.data.inherentLikelihood, change.data.inherentConsequence);
      const res = computeScore(change.data.residualLikelihood, change.data.residualConsequence);
      const row = {
        id,
        title: change.data.title || "Untitled risk",
        description: change.data.description || "",
        category: change.data.category || "",
        location: change.data.location || "",
        ownerName: change.data.ownerName || "",
        inherentLikelihood: change.data.inherentLikelihood ?? null,
        inherentConsequence: change.data.inherentConsequence ?? null,
        inherentScore: inh,
        residualLikelihood: change.data.residualLikelihood ?? null,
        residualConsequence: change.data.residualConsequence ?? null,
        residualScore: res,
        status: change.data.status || "Draft",
        nextReviewDate: change.data.nextReviewDate ?? null,
        source:
          actorType === "ai" ? "ai" : actorType === "api" ? "api" : actorType === "import" ? "import" : "manual",
        createdAt: now(),
        updatedAt: now(),
      };
      computed.push({ op: "create_risk", entityType: "risk", entityId: id, before: null, after: row });
    } else if (change.op === "update_risk") {
      const before = await getRisk(change.id);
      if (!before) continue;
      const d = change.data;
      const inherentLikelihood = d.inherentLikelihood ?? before.inherentLikelihood;
      const inherentConsequence = d.inherentConsequence ?? before.inherentConsequence;
      const residualLikelihood = d.residualLikelihood ?? before.residualLikelihood;
      const residualConsequence = d.residualConsequence ?? before.residualConsequence;
      const after = {
        ...before,
        title: d.title ?? before.title,
        description: d.description ?? before.description,
        category: d.category ?? before.category,
        location: d.location ?? before.location,
        ownerName: d.ownerName ?? before.ownerName,
        inherentLikelihood,
        inherentConsequence,
        inherentScore: computeScore(inherentLikelihood, inherentConsequence),
        residualLikelihood,
        residualConsequence,
        residualScore: computeScore(residualLikelihood, residualConsequence),
        status: d.status ?? before.status,
        nextReviewDate: d.nextReviewDate === undefined ? before.nextReviewDate : d.nextReviewDate,
        updatedAt: now(),
      };
      computed.push({ op: "update_risk", entityType: "risk", entityId: change.id, before, after });
    } else if (change.op === "delete_risk") {
      const before = await getRisk(change.id);
      if (!before) continue;
      computed.push({ op: "delete_risk", entityType: "risk", entityId: change.id, before, after: null });
    } else if (change.op === "create_control") {
      const id = change.data.id || uid("ctrl");
      const row = {
        id,
        riskId: change.data.riskId!,
        description: change.data.description || "",
        type: change.data.type || "administrative",
        implemented: change.data.implemented ?? false,
        createdAt: now(),
      };
      computed.push({ op: "create_control", entityType: "control", entityId: id, before: null, after: row });
    } else if (change.op === "update_control") {
      const before = await getControl(change.id);
      if (!before) continue;
      const after = {
        ...before,
        description: change.data.description ?? before.description,
        type: change.data.type ?? before.type,
        implemented: change.data.implemented ?? before.implemented,
      };
      computed.push({ op: "update_control", entityType: "control", entityId: change.id, before, after });
    } else if (change.op === "delete_control") {
      const before = await getControl(change.id);
      if (!before) continue;
      computed.push({ op: "delete_control", entityType: "control", entityId: change.id, before, after: null });
    }
  }

  return computed;
}

/** Performs the actual database writes for a set of already-computed ops. */
async function writeOps(ops: ComputedOp[]) {
  for (const op of ops) {
    if (op.entityType === "risk") {
      if (op.op === "create_risk") {
        await db.insert(schema.risks).values(op.after as typeof schema.risks.$inferInsert);
      } else if (op.op === "update_risk") {
        await db
          .update(schema.risks)
          .set(op.after as Partial<typeof schema.risks.$inferInsert>)
          .where(eq(schema.risks.id, op.entityId));
      } else if (op.op === "delete_risk") {
        await db.delete(schema.controls).where(eq(schema.controls.riskId, op.entityId));
        await db.delete(schema.risks).where(eq(schema.risks.id, op.entityId));
      }
    } else {
      if (op.op === "create_control") {
        await db.insert(schema.controls).values(op.after as typeof schema.controls.$inferInsert);
      } else if (op.op === "update_control") {
        await db
          .update(schema.controls)
          .set(op.after as Partial<typeof schema.controls.$inferInsert>)
          .where(eq(schema.controls.id, op.entityId));
      } else if (op.op === "delete_control") {
        await db.delete(schema.controls).where(eq(schema.controls.id, op.entityId));
      }
    }
  }
}

async function persistPlan(opts: {
  actorType: string;
  actorName: string;
  prompt?: string | null;
  summary: string;
  status: "proposed" | "applied";
  ops: ComputedOp[];
}) {
  const planId = uid("plan");
  await db.insert(schema.changePlans).values({
    id: planId,
    actorType: opts.actorType,
    actorName: opts.actorName,
    prompt: opts.prompt ?? null,
    summary: opts.summary,
    status: opts.status,
    createdAt: now(),
  });
  if (opts.ops.length > 0) {
    await db.insert(schema.changeOps).values(
      opts.ops.map((a) => ({
        id: uid("op"),
        planId,
        op: a.op,
        entityType: a.entityType,
        entityId: a.entityId,
        before: a.before ? JSON.stringify(a.before) : null,
        after: a.after ? JSON.stringify(a.after) : null,
        createdAt: now(),
      }))
    );
  }
  return planId;
}

/**
 * Computes AND immediately writes a batch of changes — used for direct UI
 * edits (the grid, forms, CSV import, the external API) where there is no
 * separate review step.
 */
export async function applyChangePlan(opts: {
  actorType: "user" | "ai" | "api" | "import";
  actorName: string;
  prompt?: string | null;
  summary: string;
  changes: ChangeOpInput[];
}) {
  const ops = await computeOps(opts.actorType, opts.changes);
  await writeOps(ops);
  const planId = await persistPlan({ ...opts, status: "applied", ops });
  return { planId, applied: ops };
}

/**
 * Computes a batch of changes and stores them as a *proposed* plan without
 * writing anything — this is what the AI chat agent calls. The user reviews
 * the diff, then hits Apply (applyProposedPlan) or discards it.
 */
export async function proposeChangePlan(opts: {
  actorType: "ai" | "user" | "api" | "import";
  actorName: string;
  prompt?: string | null;
  summary: string;
  changes: ChangeOpInput[];
}) {
  const ops = await computeOps(opts.actorType, opts.changes);
  const planId = await persistPlan({ ...opts, status: "proposed", ops });
  return { planId, ops };
}

/** Writes the stored ops of a previously-proposed plan and marks it applied. */
export async function applyProposedPlan(planId: string) {
  const plan = (await db.select().from(schema.changePlans).where(eq(schema.changePlans.id, planId)).limit(1))[0];
  if (!plan) throw new Error("Plan not found");
  if (plan.status !== "proposed") throw new Error(`Plan is already ${plan.status}`);

  const rows = await db.select().from(schema.changeOps).where(eq(schema.changeOps.planId, planId));
  const ops: ComputedOp[] = rows.map((r) => ({
    op: r.op,
    entityType: r.entityType as "risk" | "control",
    entityId: r.entityId,
    before: r.before ? JSON.parse(r.before) : null,
    after: r.after ? JSON.parse(r.after) : null,
  }));

  await writeOps(ops);
  await db.update(schema.changePlans).set({ status: "applied" }).where(eq(schema.changePlans.id, planId));
  return { planId, applied: ops };
}

/** Marks a proposed plan as discarded without writing anything. */
export async function discardProposedPlan(planId: string) {
  const plan = (await db.select().from(schema.changePlans).where(eq(schema.changePlans.id, planId)).limit(1))[0];
  if (!plan) throw new Error("Plan not found");
  if (plan.status !== "proposed") throw new Error(`Plan is already ${plan.status}`);
  await db.update(schema.changePlans).set({ status: "discarded" }).where(eq(schema.changePlans.id, planId));
  return { planId };
}

/** Reverses every op in an applied plan, in reverse order, and marks it undone. */
export async function undoChangePlan(planId: string) {
  const plan = (await db.select().from(schema.changePlans).where(eq(schema.changePlans.id, planId)).limit(1))[0];
  if (!plan) throw new Error("Plan not found");
  if (plan.status !== "applied") throw new Error(`Only an applied plan can be undone (this one is ${plan.status})`);

  const ops = await db.select().from(schema.changeOps).where(eq(schema.changeOps.planId, planId));
  const reversed = [...ops].reverse();

  for (const op of reversed) {
    const before = op.before ? JSON.parse(op.before) : null;
    if (op.entityType === "risk") {
      if (op.op === "create_risk") {
        await db.delete(schema.controls).where(eq(schema.controls.riskId, op.entityId));
        await db.delete(schema.risks).where(eq(schema.risks.id, op.entityId));
      } else if (op.op === "update_risk") {
        await db
          .update(schema.risks)
          .set(before as Partial<typeof schema.risks.$inferInsert>)
          .where(eq(schema.risks.id, op.entityId));
      } else if (op.op === "delete_risk") {
        await db.insert(schema.risks).values(before as typeof schema.risks.$inferInsert);
      }
    } else {
      if (op.op === "create_control") {
        await db.delete(schema.controls).where(eq(schema.controls.id, op.entityId));
      } else if (op.op === "update_control") {
        await db
          .update(schema.controls)
          .set(before as Partial<typeof schema.controls.$inferInsert>)
          .where(eq(schema.controls.id, op.entityId));
      } else if (op.op === "delete_control") {
        await db.insert(schema.controls).values(before as typeof schema.controls.$inferInsert);
      }
    }
  }

  await db.update(schema.changePlans).set({ status: "undone" }).where(eq(schema.changePlans.id, planId));
  return { planId, reversedOps: reversed.length };
}
