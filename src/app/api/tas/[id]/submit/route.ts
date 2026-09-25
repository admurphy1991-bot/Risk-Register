import { NextRequest, NextResponse } from "next/server";
import { loadTaForRequest } from "@/lib/ta-api";
import { getTaFull, logTaEvent, setTaStatus, validateForSubmission } from "@/lib/ta";
import { buildTaPayload, deliverToMake } from "@/lib/ta-webhook";
import { getBaseUrl } from "@/lib/settings";

export const maxDuration = 60;

/**
 * Submits the TA for H&S review: locks it, then hands it to Make.com, which
 * files the Word document into M-Files and emails the H&S manager.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/tas/[id]/submit">) {
  const { id } = await ctx.params;
  const loaded = await loadTaForRequest(id, { editable: true });
  if (loaded.error) return loaded.error;
  const { user, ta } = loaded;

  const problems = validateForSubmission(ta);
  if (problems.length) {
    return NextResponse.json({ error: "This TA isn't ready to submit yet.", problems }, { status: 400 });
  }

  const wasChanges = ta.status === "changes_requested";
  await setTaStatus(id, "submitted", { submittedAt: new Date().toISOString() });
  await logTaEvent(id, wasChanges ? "resubmitted" : "submitted", user.name);

  const updated = (await getTaFull(id))!;
  const payload = await buildTaPayload(updated, "ta.submitted", getBaseUrl(req));
  const delivery = await deliverToMake("ta.submitted", id, payload);
  await logTaEvent(id, `handoff_${delivery.status}`, "System", delivery.message);

  return NextResponse.json({ ta: await getTaFull(id), delivery });
}
