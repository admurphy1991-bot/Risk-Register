import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { db, schema } from "@/lib/db";
import { uid } from "@/lib/ids";
import { getAdapter } from "@/lib/integrations/adapters";
import { proposeChangePlan } from "@/lib/change-log";

// Inbound webhook receiver for the existing health & safety system.
// The external system POSTs an event here (e.g. a failed inspection item,
// an incident report) and it becomes a *draft* risk proposal — reviewed and
// applied by a person in the app, never written straight into the register.

export async function POST(req: NextRequest, ctx: RouteContext<"/api/v1/webhooks/[source]">) {
  const { source } = await ctx.params;
  const auth = await verifyApiKey(req);
  if (!auth) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const adapter = getAdapter(source);
  const eventId = uid("evt");
  const now = new Date().toISOString();

  if (!adapter) {
    await db.insert(schema.webhookEvents).values({
      id: eventId,
      source,
      eventType: "unknown",
      payload: JSON.stringify(payload),
      status: "error",
      error: `No adapter registered for source "${source}". See src/lib/integrations/adapters.ts.`,
      createdAt: now,
    });
    return NextResponse.json(
      { error: `No adapter registered for source "${source}"`, availableSources: ["generic", "conqa", "safetyculture"] },
      { status: 400 }
    );
  }

  const normalized = adapter.map(payload as Record<string, unknown>);
  if (!normalized) {
    await db.insert(schema.webhookEvents).values({
      id: eventId,
      source,
      eventType: "unmapped",
      payload: JSON.stringify(payload),
      status: "ignored",
      createdAt: now,
    });
    return NextResponse.json({ status: "ignored", reason: "Payload did not map to a draft risk (missing title)." });
  }

  const { planId } = await proposeChangePlan({
    actorType: "api",
    actorName: `${adapter.label} (webhook)`,
    prompt: `Inbound ${adapter.label} event: ${normalized.sourceEventType}`,
    summary: `Draft risk from ${adapter.label}: "${normalized.title}"`,
    changes: [
      {
        op: "create_risk",
        data: {
          title: normalized.title,
          description: normalized.description,
          category: normalized.category,
          location: normalized.location,
          ownerName: normalized.ownerName,
          status: normalized.status || "Draft",
        },
      },
    ],
  });

  await db.insert(schema.webhookEvents).values({
    id: eventId,
    source,
    eventType: normalized.sourceEventType,
    payload: JSON.stringify(payload),
    status: "mapped",
    resultRiskId: planId,
    createdAt: now,
  });

  return NextResponse.json({ status: "proposed", planId }, { status: 202 });
}
