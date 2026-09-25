import { NextRequest, NextResponse } from "next/server";
import { loadTaForRequest } from "@/lib/ta-api";
import { deleteTaFile } from "@/lib/ta-files";

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/tas/[id]/files/[fileId]">) {
  const { id, fileId } = await ctx.params;
  const loaded = await loadTaForRequest(id, { editable: true });
  if (loaded.error) return loaded.error;
  const ok = await deleteTaFile(id, fileId);
  if (!ok) return NextResponse.json({ error: "File not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
