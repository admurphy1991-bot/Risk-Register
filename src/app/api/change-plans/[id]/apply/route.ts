import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyProposedPlan } from "@/lib/change-log";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/change-plans/[id]/apply">) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const result = await applyProposedPlan(id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
