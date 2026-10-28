import { NextRequest, NextResponse } from "next/server";
import { loadSsspForRequest } from "@/lib/sssp-api";
import { deleteSssp, getSsspFull, logSsspEvent, updateSssp, type SsspPatch } from "@/lib/sssp";
import { deleteAllTaFiles } from "@/lib/ta-files";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/sssps/[id]">) {
  const { id } = await ctx.params;
  const loaded = await loadSsspForRequest(id);
  if (loaded.error) return loaded.error;
  return NextResponse.json({ sssp: loaded.sssp });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/sssps/[id]">) {
  const { id } = await ctx.params;
  const loaded = await loadSsspForRequest(id, { editable: true });
  if (loaded.error) return loaded.error;
  const body = (await req.json().catch(() => null)) as SsspPatch | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const before = loaded.sssp.data.taIds;
  await updateSssp(id, body);
  const after = body.data?.taIds;
  if (after && after.join() !== before.join()) await logSsspEvent(id, "tas_linked", loaded.user.name, after.join(", ") || "none");
  return NextResponse.json({ sssp: await getSsspFull(id) });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/sssps/[id]">) {
  const { id } = await ctx.params;
  const loaded = await loadSsspForRequest(id);
  if (loaded.error) return loaded.error;
  const { user, sssp } = loaded;
  if (sssp.status !== "draft" && user.role !== "admin") return NextResponse.json({ error: "Only draft SSSPs can be deleted (admins can delete any)." }, { status: 409 });
  if (user.role !== "admin" && sssp.preparedById !== user.id) return NextResponse.json({ error: "Only the person who created this SSSP (or an admin) can delete it." }, { status: 403 });
  await deleteAllTaFiles(id);
  deleteSssp(id);
  return NextResponse.json({ ok: true });
}
