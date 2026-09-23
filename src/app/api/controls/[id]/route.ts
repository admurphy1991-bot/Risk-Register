import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyChangePlan } from "@/lib/change-log";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/controls/[id]">) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { applied } = await applyChangePlan({
    actorType: "user",
    actorName: user.name,
    summary: `Updated control ${id}`,
    changes: [{ op: "update_control", id, data: body }],
  });
  if (!applied.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ control: applied[0].after });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/controls/[id]">) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const { applied } = await applyChangePlan({
    actorType: "user",
    actorName: user.name,
    summary: `Removed control ${id}`,
    changes: [{ op: "delete_control", id }],
  });
  if (!applied.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
