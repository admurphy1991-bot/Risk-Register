import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const events = await db.select().from(schema.webhookEvents).orderBy(desc(schema.webhookEvents.createdAt)).limit(50);
  return NextResponse.json({ events });
}
