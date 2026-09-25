import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTaFull } from "@/lib/ta";
import { renderTaDocument, verifyDocToken } from "@/lib/ta-webhook";

export const maxDuration = 60;

/**
 * Downloads the TA as a Word document. Works for a signed-in user, or with a
 * signed `?token=` (the link included in the Make.com payload, valid 30 days).
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/tas/[id]/document">) {
  const { id } = await ctx.params;
  const token = req.nextUrl.searchParams.get("token");
  const authorised = (await getSession()) !== null || (token ? await verifyDocToken(token, id) : false);
  if (!authorised) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ta = await getTaFull(id);
  if (!ta) return NextResponse.json({ error: "Task analysis not found" }, { status: 404 });

  const { buffer, filename } = await renderTaDocument(ta);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
