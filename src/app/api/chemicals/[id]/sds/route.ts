import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getChemical, mapChemical, removeSds, storeSds } from "@/lib/chemicals";
import { canEditChemicals } from "@/lib/chemicals-api";

export const maxDuration = 60;

/** Downloads the SDS PDF held in the app. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/chemicals/[id]/sds">) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const row = await getChemical(id);
  if (!row?.sdsStoredPath) return NextResponse.json({ error: "No SDS uploaded for this chemical" }, { status: 404 });
  const buf = await fs.readFile(row.sdsStoredPath).catch(() => null);
  if (!buf) return NextResponse.json({ error: "The SDS file is missing on the server" }, { status: 404 });
  const name = (row.sdsFilename || `${row.productName} SDS`).replace(/\.pdf$/i, "") + ".pdf";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name.replace(/[^\w .()-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/chemicals/[id]/sds">) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditChemicals(user)) return NextResponse.json({ error: "Only H&S or admins can upload SDSs." }, { status: 403 });
  const { id } = await ctx.params;
  if (!(await getChemical(id))) return NextResponse.json({ error: "Chemical not found" }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "No file received" }, { status: 400 });
  try {
    await storeSds(id, file);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ chemical: mapChemical((await getChemical(id))!) });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/chemicals/[id]/sds">) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditChemicals(user)) return NextResponse.json({ error: "Only H&S or admins can remove SDSs." }, { status: 403 });
  const { id } = await ctx.params;
  await removeSds(id);
  return NextResponse.json({ chemical: mapChemical((await getChemical(id))!) });
}
