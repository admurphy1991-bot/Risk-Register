import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteChemical, getChemical, mapChemical, updateChemical, type ChemicalInput } from "@/lib/chemicals";
import { canEditChemicals } from "@/lib/chemicals-api";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/chemicals/[id]">) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditChemicals(user)) return NextResponse.json({ error: "Only H&S or admins can edit the chemical register." }, { status: 403 });
  const { id } = await ctx.params;
  if (!(await getChemical(id))) return NextResponse.json({ error: "Chemical not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as ChemicalInput | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  try {
    await updateChemical(id, body);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ chemical: mapChemical((await getChemical(id))!) });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/chemicals/[id]">) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditChemicals(user)) return NextResponse.json({ error: "Only H&S or admins can remove chemicals." }, { status: 403 });
  const { id } = await ctx.params;
  await deleteChemical(id);
  return NextResponse.json({ ok: true });
}
