import { NextRequest, NextResponse } from "next/server";
import { canReview, loadTaForRequest } from "@/lib/ta-api";
import { getTaFull, logTaEvent, setTaStatus } from "@/lib/ta";
import { buildTaPayload, deliverToMake } from "@/lib/ta-webhook";
import { getBaseUrl } from "@/lib/settings";

export const maxDuration = 60;

/**
 * H&S review actions:
 *  - approve  (submitted -> approved)          — sends ta.approved to Make.com
 *  - changes  (submitted -> changes_requested) — sends ta.changes_requested; comment required
 *  - close    (approved  -> closed)            — job finished; its risks drop off the live rollup
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/tas/[id]/review">) {
  const { id } = await ctx.params;
  const loaded = await loadTaForRequest(id);
  if (loaded.error) return loaded.error;
  const { user, ta } = loaded;

  const body = await req.json().catch(() => null);
  const decision = body?.decision as "approve" | "changes" | "close" | undefined;
  const comment = typeof body?.comment === "string" ? body.comment.trim().slice(0, 2000) : "";
  const now = new Date().toISOString();

  if (decision === "close") {
    if (ta.status !== "approved") return NextResponse.json({ error: "Only an approved TA can be closed." }, { status: 409 });
    if (!canReview(user) && user.id !== ta.preparedById) {
      return NextResponse.json({ error: "Only the preparer, H&S or an admin can close a TA." }, { status: 403 });
    }
    await setTaStatus(id, "closed");
    await logTaEvent(id, "closed", user.name, comment || null);
    return NextResponse.json({ ta: await getTaFull(id) });
  }

  if (decision !== "approve" && decision !== "changes") {
    return NextResponse.json({ error: "decision must be approve, changes or close" }, { status: 400 });
  }
  if (!canReview(user)) {
    return NextResponse.json({ error: "Only H&S reviewers or admins can approve TAs or request changes." }, { status: 403 });
  }
  if (user.role !== "admin" && user.id === ta.preparedById) {
    return NextResponse.json({ error: "You can't review a TA you prepared — ask another reviewer." }, { status: 403 });
  }
  if (ta.status !== "submitted") {
    return NextResponse.json({ error: `Only a submitted TA can be reviewed (this one is ${ta.status.replace("_", " ")}).` }, { status: 409 });
  }
  if (decision === "changes" && !comment) {
    return NextResponse.json({ error: "Say what needs changing so the project manager can fix it." }, { status: 400 });
  }

  const status = decision === "approve" ? "approved" : "changes_requested";
  await setTaStatus(id, status, { reviewedAt: now, reviewedByName: user.name, reviewComment: comment || null });
  await logTaEvent(id, status, user.name, comment || null);

  const updated = (await getTaFull(id))!;
  const event = decision === "approve" ? "ta.approved" : "ta.changes_requested";
  const delivery = await deliverToMake(event, id, await buildTaPayload(updated, event, getBaseUrl(req)));
  await logTaEvent(id, `handoff_${delivery.status}`, "System", delivery.message);

  return NextResponse.json({ ta: await getTaFull(id), delivery });
}
