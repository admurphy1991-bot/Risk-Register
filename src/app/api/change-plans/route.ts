import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plans = await db
    .select()
    .from(schema.changePlans)
    .orderBy(desc(schema.changePlans.createdAt))
    .limit(50);
  return NextResponse.json({ plans });
}
