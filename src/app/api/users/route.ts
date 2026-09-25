import { NextRequest, NextResponse } from "next/server";
import { getSession, hashPassword, findUserByEmail, USER_ROLES } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { uid } from "@/lib/ids";
import { asc } from "drizzle-orm";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db.select().from(schema.users).orderBy(asc(schema.users.name));
  return NextResponse.json({
    users: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Only admins can add users." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const name = String(body?.name || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const role = String(body?.role || "manager");

  if (!name || !email) return NextResponse.json({ error: "Name and email are required." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "That email doesn't look valid." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Temporary password must be at least 8 characters." }, { status: 400 });
  if (!(USER_ROLES as readonly string[]).includes(role)) return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  if (await findUserByEmail(email)) return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });

  const id = uid("usr");
  await db.insert(schema.users).values({
    id,
    name,
    email,
    passwordHash: await hashPassword(password),
    role,
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ user: { id, name, email, role } }, { status: 201 });
}
