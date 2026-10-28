import { NextRequest, NextResponse } from "next/server";
import { loadSsspForRequest } from "@/lib/sssp-api";
import { deleteTaFile } from "@/lib/ta-files";

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/sssps/[id]/files/[fileId]">) {
  const { id, fileId } = await ctx.params;
  const loaded = await loadSsspForRequest(id, { editable: true });
  if (loaded.error) return loaded.error;
  const ok = await deleteTaFile(id, fileId);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "File not found" }, { status: 404 });
}
