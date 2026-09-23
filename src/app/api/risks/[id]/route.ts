import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { applyChangePlan } from "@/lib/change-log";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/risks/[id]">) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const rows = await db.select().from(schema.risks).where(eq(schema.risks.id, id)).limit(1);
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const controls = await db.select().from(schema.controls).where(eq(schema.controls.riskId, id));
  return NextResponse.json({ risk: { ...rows[0], controls } });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/risks/[id]">) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { planId, applied } = await applyChangePlan({
    actorType: "user",
    actorName: user.name,
    summary: `Updated risk ${id}`,
    changes: [{ op: "update_risk", id, data: body }],
  });

  if (!applied.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ planId, risk: applied[0].after });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/risks/[id]">) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const { planId, applied } = await applyChangePlan({
    actorType: "user",
    actorName: user.name,
    summary: `Deleted risk ${id}`,
    changes: [{ op: "delete_risk", id }],
  });

  if (!applied.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ planId, ok: true });
}
