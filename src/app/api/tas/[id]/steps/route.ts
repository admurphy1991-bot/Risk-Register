import { NextRequest, NextResponse } from "next/server";
import { loadTaForRequest } from "@/lib/ta-api";
import { db, schema } from "@/lib/db";
import { getTaSteps, saveSteps, type StepInput } from "@/lib/ta";

/** Replaces the TA's job steps with the supplied list (autosaved by the builder). */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/tas/[id]/steps">) {
  const { id } = await ctx.params;
  const loaded = await loadTaForRequest(id, { editable: true });
  if (loaded.error) return loaded.error;

  const body = await req.json().catch(() => null);
  const steps = body?.steps;
  if (!Array.isArray(steps)) return NextResponse.json({ error: "Expected { steps: [...] }" }, { status: 400 });
  if (steps.length > 60) return NextResponse.json({ error: "A TA can have at most 60 steps." }, { status: 400 });

  const riskIds = new Set((await db.select({ id: schema.risks.id }).from(schema.risks)).map((r) => r.id));
  saveSteps(id, steps as StepInput[], riskIds);
  return NextResponse.json({ steps: await getTaSteps(id) });
}
