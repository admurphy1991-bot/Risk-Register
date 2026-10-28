import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createSssp, listSssps } from "@/lib/sssp";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ sssps: await listSssps() });
}

/** Body (optional): { fromTaId } — start from a TA's project details, risks and chemicals. */
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const fromTaId = typeof body?.fromTaId === "string" && /^TA-\d+$/.test(body.fromTaId) ? body.fromTaId : undefined;
  const id = await createSssp(user, { fromTaId });
  return NextResponse.json({ id }, { status: 201 });
}
