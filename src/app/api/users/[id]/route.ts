import { NextRequest, NextResponse } from "next/server";
import { getSession, hashPassword } from "@/lib/auth";
import { USER_ROLES } from "@/lib/roles";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

/** Admin: change a user's name/role or set a new temporary password. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/users/[id]">) {
  const me = await getSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ error: "Only admins can edit users." }, { status: 403 });
  const { id } = await ctx.params;

  const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  if (!rows[0]) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const set: Partial<typeof schema.users.$inferInsert> = {};
  if (typeof body?.name === "string" && body.name.trim()) set.name = body.name.trim();
  if (typeof body?.role === "string") {
    if (!(USER_ROLES as readonly string[]).includes(body.role)) return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    if (id === me.id && body.role !== "admin") {
      return NextResponse.json({ error: "You can't remove your own admin access." }, { status: 400 });
    }
    set.role = body.role;
  }
  if (typeof body?.password === "string" && body.password) {
    if (body.password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    set.passwordHash = await hashPassword(body.password);
  }
  if (!Object.keys(set).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  await db.update(schema.users).set(set).where(eq(schema.users.id, id));
  return NextResponse.json({ ok: true });
}
