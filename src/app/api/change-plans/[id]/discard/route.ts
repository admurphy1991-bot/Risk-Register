import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { discardProposedPlan } from "@/lib/change-log";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/change-plans/[id]/discard">) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const result = await discardProposedPlan(id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
