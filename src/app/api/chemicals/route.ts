import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createChemical, listChemicals, mapChemical, getChemical, type ChemicalInput } from "@/lib/chemicals";
import { ensureChemicalsSeeded } from "@/lib/chemicals-api";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  ensureChemicalsSeeded();
  return NextResponse.json({ chemicals: await listChemicals() });
}

/** Adds a chemical. New entries start as Draft until H&S approve them. */
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as ChemicalInput | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  try {
    const id = await createChemical({ ...body, status: "Draft" });
    return NextResponse.json({ chemical: mapChemical((await getChemical(id))!) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
