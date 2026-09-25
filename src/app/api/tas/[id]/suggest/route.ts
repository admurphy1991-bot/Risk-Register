import { NextRequest, NextResponse } from "next/server";
import { loadTaForRequest } from "@/lib/ta-api";
import { suggestTaSteps, aiErrorMessage } from "@/lib/ta-ai";
import { logTaEvent } from "@/lib/ta";

export const maxDuration = 180;

/**
 * Drafts job steps with linked register risks and pre-selected controls.
 * Returns the suggestion only — the builder shows it and the PM decides
 * whether to use it (nothing is saved here).
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/tas/[id]/suggest">) {
  const { id } = await ctx.params;
  const loaded = await loadTaForRequest(id, { editable: true });
  if (loaded.error) return loaded.error;
  const { user, ta } = loaded;

  if (!ta.overview.trim() && ta.files.length === 0) {
    return NextResponse.json(
      { error: "Add an overview of the work (or upload the proposal) first so the AI knows what the job involves." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const focus = typeof body?.focus === "string" ? body.focus.slice(0, 1000) : undefined;

  try {
    const steps = await suggestTaSteps(ta, { focus });
    await logTaEvent(id, "ai_suggested_steps", user.name, `${steps.length} steps suggested`);
    return NextResponse.json({ steps });
  } catch (err) {
    console.error("TA step suggestion failed:", err);
    return NextResponse.json({ error: `Couldn't suggest steps: ${aiErrorMessage(err)}` }, { status: 502 });
  }
}
