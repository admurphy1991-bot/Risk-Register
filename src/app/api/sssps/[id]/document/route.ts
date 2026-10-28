import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSsspFull } from "@/lib/sssp";
import { verifyDocToken } from "@/lib/ta-webhook";
import { renderSsspDocument } from "@/lib/sssp-webhook";

export const maxDuration = 60;

/** The SSSP as a Word document, filled into Sansom's master SSSP template. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/sssps/[id]/document">) {
  const { id } = await ctx.params;
  const token = req.nextUrl.searchParams.get("token");
  const authorised = (await getSession()) !== null || (token ? await verifyDocToken(token, id) : false);
  if (!authorised) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sssp = await getSsspFull(id);
  if (!sssp) return NextResponse.json({ error: "SSSP not found" }, { status: 404 });
  try {
    const { buffer, filename } = await renderSsspDocument(sssp);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename.replace(/[^\w .()-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("SSSP document failed:", err);
    return NextResponse.json({ error: `Couldn't build the document: ${(err as Error).message}` }, { status: 500 });
  }
}
