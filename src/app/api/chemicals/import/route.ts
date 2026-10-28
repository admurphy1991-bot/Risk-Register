import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { importChemicalsCsv } from "@/lib/chemicals";
import { canEditChemicals } from "@/lib/chemicals-api";

/** Upload a Donesafe "Chemical register" CSV export (field name: "file"). */
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditChemicals(user)) return NextResponse.json({ error: "Only H&S or admins can import the chemical register." }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "No file received" }, { status: 400 });
  if (!/\.csv$/i.test(file.name)) return NextResponse.json({ error: "Upload the Donesafe export as a .csv file." }, { status: 400 });
  try {
    const result = importChemicalsCsv(await file.text());
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
