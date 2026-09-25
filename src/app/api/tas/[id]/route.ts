import { NextRequest, NextResponse } from "next/server";
import { loadTaForRequest } from "@/lib/ta-api";
import { deleteTa, getTaFull, updateTaHeader, type TaHeaderPatch } from "@/lib/ta";
import { deleteAllTaFiles } from "@/lib/ta-files";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/tas/[id]">) {
  const { id } = await ctx.params;
  const loaded = await loadTaForRequest(id);
  if (loaded.error) return loaded.error;
  return NextResponse.json({ ta: loaded.ta });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/tas/[id]">) {
  const { id } = await ctx.params;
  const loaded = await loadTaForRequest(id, { editable: true });
  if (loaded.error) return loaded.error;
  const body = (await req.json().catch(() => null)) as TaHeaderPatch | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  await updateTaHeader(id, body);
  return NextResponse.json({ ta: await getTaFull(id) });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/tas/[id]">) {
  const { id } = await ctx.params;
  const loaded = await loadTaForRequest(id);
  if (loaded.error) return loaded.error;
  const { user, ta } = loaded;
  if (ta.status !== "draft" && user.role !== "admin") {
    return NextResponse.json({ error: "Only draft TAs can be deleted (admins can delete any)." }, { status: 409 });
  }
  if (user.role !== "admin" && ta.preparedById !== user.id) {
    return NextResponse.json({ error: "Only the person who created this TA (or an admin) can delete it." }, { status: 403 });
  }
  await deleteAllTaFiles(id);
  deleteTa(id);
  return NextResponse.json({ ok: true });
}
