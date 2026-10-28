import { NextRequest, NextResponse } from "next/server";
import { loadSsspForRequest } from "@/lib/sssp-api";
import { canReview } from "@/lib/ta-api";
import { getSsspFull, logSsspEvent, setSsspStatus } from "@/lib/sssp";
import { buildSsspPayload } from "@/lib/sssp-webhook";
import { deliverToMake } from "@/lib/ta-webhook";
import { getBaseUrl } from "@/lib/settings";

export const maxDuration = 60;

/** H&S review: approve | changes (comment required) | close — same rules as TAs. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/sssps/[id]/review">) {
  const { id } = await ctx.params;
  const loaded = await loadSsspForRequest(id);
  if (loaded.error) return loaded.error;
  const { user, sssp } = loaded;
  const body = await req.json().catch(() => null);
  const decision = body?.decision as "approve" | "changes" | "close" | undefined;
  const comment = typeof body?.comment === "string" ? body.comment.trim().slice(0, 2000) : "";

  if (decision === "close") {
    if (sssp.status !== "approved") return NextResponse.json({ error: "Only an approved SSSP can be closed." }, { status: 409 });
    if (!canReview(user) && user.id !== sssp.preparedById) return NextResponse.json({ error: "Only the preparer, H&S or an admin can close an SSSP." }, { status: 403 });
    await setSsspStatus(id, "closed");
    await logSsspEvent(id, "closed", user.name, comment || null);
    return NextResponse.json({ sssp: await getSsspFull(id) });
  }
  if (decision !== "approve" && decision !== "changes") return NextResponse.json({ error: "decision must be approve, changes or close" }, { status: 400 });
  if (!canReview(user)) return NextResponse.json({ error: "Only H&S reviewers or admins can approve SSSPs or request changes." }, { status: 403 });
  if (user.role !== "admin" && user.id === sssp.preparedById) return NextResponse.json({ error: "You can't review an SSSP you prepared — ask another reviewer." }, { status: 403 });
  if (sssp.status !== "submitted") return NextResponse.json({ error: `Only a submitted SSSP can be reviewed (this one is ${sssp.status.replace("_", " ")}).` }, { status: 409 });
  if (decision === "changes" && !comment) return NextResponse.json({ error: "Say what needs changing so the project manager can fix it." }, { status: 400 });

  const status = decision === "approve" ? "approved" : "changes_requested";
  await setSsspStatus(id, status, { reviewedAt: new Date().toISOString(), reviewedByName: user.name, reviewComment: comment || null });
  await logSsspEvent(id, status, user.name, comment || null);
  const event = decision === "approve" ? "sssp.approved" : "sssp.changes_requested";
  const updated = (await getSsspFull(id))!;
  const delivery = await deliverToMake(event, id, await buildSsspPayload(updated, event, getBaseUrl(req)));
  await logSsspEvent(id, `handoff_${delivery.status}`, "System", delivery.message);
  return NextResponse.json({ sssp: await getSsspFull(id), delivery });
}
