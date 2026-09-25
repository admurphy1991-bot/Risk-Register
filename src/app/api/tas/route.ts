import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createTa, listTas } from "@/lib/ta";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ tas: await listTas() });
}

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = await createTa(user);
  return NextResponse.json({ id }, { status: 201 });
}
