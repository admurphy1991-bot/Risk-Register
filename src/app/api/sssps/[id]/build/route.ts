import { NextRequest, NextResponse } from "next/server";
import { loadSsspForRequest } from "@/lib/sssp-api";
import { draftSssp } from "@/lib/sssp-ai";
import { aiErrorMessage } from "@/lib/ta-ai";
import { mergeDraft } from "@/lib/sssp-merge";
import { getSsspFull, getSsspHeader, logSsspEvent, updateSssp } from "@/lib/sssp";

export const maxDuration = 180;

/**
 * "Build SSSP with AI" — drafts the job-specific parts of the SSSP from the
 * uploaded documents and linked TAs. Never overwrites what a person typed.
 * Body (optional): { instructions }
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/sssps/[id]/build">) {
  const { id } = await ctx.params;
  const loaded = await loadSsspForRequest(id, { editable: true });
  if (loaded.error) return loaded.error;
  const body = await req.json().catch(() => ({}));
  const instructions = typeof body?.instructions === "string" ? body.instructions.trim().slice(0, 2000) : "";

  const header = (await getSsspHeader(id))!;
  let draft;
  try {
    draft = await draftSssp(header, { instructions });
  } catch (err) {
    console.error("SSSP AI build failed:", err);
    return NextResponse.json({ error: aiErrorMessage(err) }, { status: 502 });
  }
  const { patch, aiKeys, filled, kept } = mergeDraft(header, draft);
  await updateSssp(id, patch, { aiFilled: aiKeys });
  await logSsspEvent(id, "ai_built", loaded.user.name, filled.length ? `Filled: ${filled.join(", ")}` : "No changes");
  return NextResponse.json({ sssp: await getSsspFull(id), filled, kept, notes: draft.notes || null });
}
