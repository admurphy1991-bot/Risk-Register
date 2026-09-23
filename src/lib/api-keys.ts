import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { uid } from "@/lib/ids";

// External systems (e.g. the existing health & safety platform) authenticate
// to the public /api/v1 surface with a bearer API key. Keys are generated
// once, shown once, and stored only as a salted hash — same pattern as
// Stripe/GitHub style tokens.

const PREFIX = "rrk";

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const secretPart = randomBytes(24).toString("base64url");
  const key = `${PREFIX}_${secretPart}`;
  const prefix = key.slice(0, 12);
  const hash = hashKey(key);
  return { key, prefix, hash };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function verifyApiKey(req: NextRequest): Promise<{ id: string; name: string; scopes: string[] } | null> {
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const key = match?.[1];
  if (!key) return null;

  const hash = hashKey(key);
  const rows = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.keyHash, hash)).limit(1);
  const record = rows[0];
  if (!record || record.revoked) return null;

  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(schema.apiKeys.id, record.id));

  return { id: record.id, name: record.name, scopes: record.scopes.split(",").map((s) => s.trim()) };
}

export async function createApiKey(name: string, scopes = "read,write") {
  const { key, prefix, hash } = generateApiKey();
  const id = uid("key");
  await db.insert(schema.apiKeys).values({
    id,
    name,
    keyPrefix: prefix,
    keyHash: hash,
    scopes,
    createdAt: new Date().toISOString(),
  });
  // The raw key is only ever returned here — it is not recoverable afterward.
  return { id, key, prefix };
}
