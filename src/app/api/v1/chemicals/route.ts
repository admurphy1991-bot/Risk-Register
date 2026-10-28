import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { importChemicalsCsv, listChemicals } from "@/lib/chemicals";
import { ensureChemicalsSeeded } from "@/lib/chemicals-api";

// API-key access to the chemical register for the H&S system / Make.com.
//   GET  /api/v1/chemicals           → the register as JSON
//   POST /api/v1/chemicals           → body: a Donesafe chemical-register CSV
//        (Content-Type: text/csv, or JSON {"csv": "..."}) — upserts on Record ID

export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req);
  if (!auth) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  ensureChemicalsSeeded();
  return NextResponse.json({ chemicals: await listChemicals() });
}

export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req);
  if (!auth) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  if (!auth.scopes.includes("write")) return NextResponse.json({ error: "This API key does not have write scope" }, { status: 403 });
  const type = req.headers.get("content-type") || "";
  const csv = type.includes("json") ? ((await req.json().catch(() => null))?.csv as string | undefined) : await req.text();
  if (!csv || typeof csv !== "string") return NextResponse.json({ error: "Send the Donesafe CSV as the body (text/csv) or as {\"csv\": \"...\"}." }, { status: 400 });
  try {
    return NextResponse.json({ result: importChemicalsCsv(csv) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
