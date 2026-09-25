import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

// Key/value settings editable from the Settings page, with environment
// variables as a fallback so they can also be set at deploy time.

export async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const ts = new Date().toISOString();
  const existing = await getSetting(key);
  if (existing === null) {
    await db.insert(schema.appSettings).values({ key, value, updatedAt: ts });
  } else {
    await db.update(schema.appSettings).set({ value, updatedAt: ts }).where(eq(schema.appSettings.key, key));
  }
}

export type TaWorkflowSettings = {
  makeWebhookUrl: string;
  mfilesEmail: string;
  hsManagerEmail: string;
  hsManagerName: string;
};

const KEYS: Record<keyof TaWorkflowSettings, { key: string; env: string }> = {
  makeWebhookUrl: { key: "ta.makeWebhookUrl", env: "MAKE_WEBHOOK_URL" },
  mfilesEmail: { key: "ta.mfilesEmail", env: "MFILES_EMAIL" },
  hsManagerEmail: { key: "ta.hsManagerEmail", env: "HS_MANAGER_EMAIL" },
  hsManagerName: { key: "ta.hsManagerName", env: "HS_MANAGER_NAME" },
};

export async function getTaWorkflowSettings(): Promise<TaWorkflowSettings> {
  const out = {} as TaWorkflowSettings;
  for (const [field, { key, env }] of Object.entries(KEYS) as [keyof TaWorkflowSettings, { key: string; env: string }][]) {
    const stored = await getSetting(key);
    out[field] = (stored ?? process.env[env] ?? "").trim();
  }
  return out;
}

export async function saveTaWorkflowSettings(patch: Partial<TaWorkflowSettings>) {
  for (const [field, value] of Object.entries(patch) as [keyof TaWorkflowSettings, string][]) {
    if (!(field in KEYS) || typeof value !== "string") continue;
    await setSetting(KEYS[field].key, value.trim());
  }
}

/** Public base URL for links in emails/webhooks (Railway sets x-forwarded-*). */
export function getBaseUrl(req: Request): string {
  const envUrl = process.env.APP_URL?.replace(/\/+$/, "");
  if (envUrl) return envUrl;
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
}
