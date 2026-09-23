import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { asc } from "drizzle-orm";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const categories = await db.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder));
  const locations = await db.select().from(schema.locations).orderBy(asc(schema.locations.sortOrder));
  return NextResponse.json({ categories, locations });
}
