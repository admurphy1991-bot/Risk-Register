import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { db, schema } from "@/lib/db";
import { applyChangePlan } from "@/lib/change-log";

// Public, API-key authenticated surface for external systems (e.g. the
// existing health & safety platform) to read and write the risk register.
// Auth: `Authorization: Bearer rrk_...` — generate keys from Settings > API
// keys in the app, or POST /api/api-keys while signed in.

export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req);
  if (!auth) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });

  const risks = await db.select().from(schema.risks);
  return NextResponse.json({ risks });
}

export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req);
  if (!auth) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  if (!auth.scopes.includes("write")) {
    return NextResponse.json({ error: "This API key does not have write scope" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const { planId, applied } = await applyChangePlan({
    actorType: "api",
    actorName: auth.name,
    summary: `[API] Created risk "${body.title}" via ${auth.name}`,
    changes: [{ op: "create_risk", data: body }],
  });

  return NextResponse.json({ planId, risk: applied[0]?.after }, { status: 201 });
}
