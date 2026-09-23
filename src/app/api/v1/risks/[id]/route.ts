import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { applyChangePlan } from "@/lib/change-log";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/v1/risks/[id]">) {
  const auth = await verifyApiKey(req);
  if (!auth) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  const { id } = await ctx.params;

  const rows = await db.select().from(schema.risks).where(eq(schema.risks.id, id)).limit(1);
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const controls = await db.select().from(schema.controls).where(eq(schema.controls.riskId, id));
  return NextResponse.json({ risk: { ...rows[0], controls } });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/v1/risks/[id]">) {
  const auth = await verifyApiKey(req);
  if (!auth) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  if (!auth.scopes.includes("write")) {
    return NextResponse.json({ error: "This API key does not have write scope" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { planId, applied } = await applyChangePlan({
    actorType: "api",
    actorName: auth.name,
    summary: `[API] Updated risk ${id} via ${auth.name}`,
    changes: [{ op: "update_risk", id, data: body }],
  });
  if (!applied.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ planId, risk: applied[0].after });
}
