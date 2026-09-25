import { NextRequest, NextResponse } from "next/server";
import { loadTaForRequest } from "@/lib/ta-api";
import { getTaFull, logTaEvent } from "@/lib/ta";
import { buildTaPayload, deliverToMake, type TaWebhookEvent } from "@/lib/ta-webhook";
import { getBaseUrl } from "@/lib/settings";

export const maxDuration = 60;

/** Re-sends the latest Make.com event for this TA (e.g. after a failed delivery). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/tas/[id]/resend">) {
  const { id } = await ctx.params;
  const loaded = await loadTaForRequest(id);
  if (loaded.error) return loaded.error;
  const { user, ta } = loaded;

  const event: TaWebhookEvent | null =
    ta.status === "submitted" ? "ta.submitted" : ta.status === "approved" ? "ta.approved" : ta.status === "changes_requested" ? "ta.changes_requested" : null;
  if (!event) return NextResponse.json({ error: "Nothing to resend — this TA hasn't been submitted." }, { status: 409 });

  const delivery = await deliverToMake(event, id, await buildTaPayload(ta, event, getBaseUrl(req)));
  await logTaEvent(id, `handoff_${delivery.status}`, user.name, `Resent ${event}: ${delivery.message}`);
  return NextResponse.json({ ta: await getTaFull(id), delivery });
}
