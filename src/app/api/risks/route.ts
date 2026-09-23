import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { applyChangePlan } from "@/lib/change-log";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const risks = await db.select().from(schema.risks);
  const controls = await db.select().from(schema.controls);
  const controlsByRisk: Record<string, typeof controls> = {};
  for (const c of controls) {
    (controlsByRisk[c.riskId] ||= []).push(c);
  }
  const withControls = risks.map((r) => ({ ...r, controls: controlsByRisk[r.id] || [] }));
  return NextResponse.json({ risks: withControls });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const { planId, applied } = await applyChangePlan({
    actorType: "user",
    actorName: user.name,
    summary: `Created risk "${body.title}"`,
    changes: [{ op: "create_risk", data: body }],
  });

  return NextResponse.json({ planId, risk: applied[0]?.after }, { status: 201 });
}
