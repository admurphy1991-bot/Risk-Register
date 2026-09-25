import { NextRequest, NextResponse } from "next/server";
import { loadTaForRequest } from "@/lib/ta-api";
import { logTaEvent } from "@/lib/ta";
import { storeTaFile, MAX_FILES_PER_TA } from "@/lib/ta-files";

export const maxDuration = 60;

/** Multipart upload of one or more supporting documents (field name: "files"). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/tas/[id]/files">) {
  const { id } = await ctx.params;
  const loaded = await loadTaForRequest(id, { editable: true });
  if (loaded.error) return loaded.error;
  const { user, ta } = loaded;

  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("files") || []).filter((f): f is File => typeof f !== "string");
  if (!files.length) return NextResponse.json({ error: "No files received." }, { status: 400 });
  if (ta.files.length + files.length > MAX_FILES_PER_TA) {
    return NextResponse.json({ error: `A TA can hold up to ${MAX_FILES_PER_TA} supporting documents.` }, { status: 400 });
  }

  const stored = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      stored.push(await storeTaFile(id, f));
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  if (stored.length) await logTaEvent(id, "files_added", user.name, stored.map((s) => s.filename).join(", "));
  return NextResponse.json({ files: stored, errors }, { status: stored.length ? 201 : 400 });
}
