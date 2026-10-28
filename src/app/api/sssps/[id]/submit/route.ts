import { NextRequest, NextResponse } from "next/server";
import { loadSsspForRequest } from "@/lib/sssp-api";
import { getSsspFull, logSsspEvent, setSsspStatus, ssspProblems } from "@/lib/sssp";
import { buildSsspPayload } from "@/lib/sssp-webhook";
import { deliverToMake } from "@/lib/ta-webhook";
import { getBaseUrl } from "@/lib/settings";

export const maxDuration = 60;

/** Locks the SSSP and sends it for H&S review (sssp.submitted to Make.com). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/sssps/[id]/submit">) {
  const { id } = await ctx.params;
  const loaded = await loadSsspForRequest(id, { editable: true });
  if (loaded.error) return loaded.error;
  const { user, sssp } = loaded;
  const problems = ssspProblems(sssp);
  if (problems.length) return NextResponse.json({ error: "This SSSP isn't ready to submit yet.", problems }, { status: 400 });

  const wasChanges = sssp.status === "changes_requested";
  await setSsspStatus(id, "submitted", { submittedAt: new Date().toISOString() });
  await logSsspEvent(id, wasChanges ? "resubmitted" : "submitted", user.name);
  const updated = (await getSsspFull(id))!;
  const delivery = await deliverToMake("sssp.submitted", id, await buildSsspPayload(updated, "sssp.submitted", getBaseUrl(req)));
  await logSsspEvent(id, `handoff_${delivery.status}`, "System", delivery.message);
  return NextResponse.json({ sssp: await getSsspFull(id), delivery });
}
