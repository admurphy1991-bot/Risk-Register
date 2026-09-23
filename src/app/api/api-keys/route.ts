import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { createApiKey } from "@/lib/api-keys";
import { desc } from "drizzle-orm";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db.select().from(schema.apiKeys).orderBy(desc(schema.apiKeys.createdAt));
  // Never return the hash.
  const keys = rows.map((row) => ({
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: row.scopes,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revoked: row.revoked,
  }));
  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const name = (body?.name || "").toString().trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const scopes = (body?.scopes || "read,write").toString();

  const result = await createApiKey(name, scopes);
  return NextResponse.json(result, { status: 201 });
}
