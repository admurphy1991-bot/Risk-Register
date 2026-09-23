import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/api-keys/[id]">) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await db.update(schema.apiKeys).set({ revoked: true }).where(eq(schema.apiKeys.id, id));
  return NextResponse.json({ ok: true });
}
