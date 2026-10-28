// Client-safe chemical register types and helpers (no database imports).

export type Chemical = {
  id: string;
  productName: string;
  status: string;
  unNumber: string;
  classification: string;
  hazards: string[];
  location: string;
  sdsFilename: string;
  sdsDate: string | null;
  sdsExpiry: string | null;
  hasSdsFile: boolean;
  notes: string;
  source: string;
  externalCreatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const CHEMICAL_STATUSES = ["Approved for Use", "Draft", "No Longer in Use"] as const;

export const HAZARD_TYPES = ["Health hazards", "Physical hazards", "Environmental hazards"] as const;

export const CLASSIFICATIONS = [
  "Hazardous substance",
  "Dangerous good",
  "Dangerous good, Hazardous substance",
  "Not classified as Hazardous or Dangerous",
] as const;

export type SdsState = "ok" | "expiring" | "expired" | "missing";

export const SDS_STATE_LABELS: Record<SdsState, string> = {
  ok: "SDS current",
  expiring: "SDS expiring soon",
  expired: "SDS expired",
  missing: "No SDS",
};

export const SDS_STATE_STYLES: Record<SdsState, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  expiring: "bg-amber-50 text-amber-800 border-amber-200",
  expired: "bg-red-50 text-red-700 border-red-200",
  missing: "bg-slate-100 text-slate-600 border-slate-200",
};

/** SDS revisions are valid for 5 years from the latest revision date. */
export function defaultSdsExpiry(sdsDate: string | null | undefined): string | null {
  if (!sdsDate || !/^\d{4}-\d{2}-\d{2}$/.test(sdsDate)) return null;
  const [y, m, d] = sdsDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y + 5, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

export function sdsState(c: Pick<Chemical, "sdsDate" | "sdsExpiry" | "sdsFilename" | "hasSdsFile">, today = new Date()): SdsState {
  const expiry = c.sdsExpiry || defaultSdsExpiry(c.sdsDate);
  if (!expiry && !c.sdsFilename && !c.hasSdsFile) return "missing";
  if (!expiry) return "ok";
  const t = today.toISOString().slice(0, 10);
  if (expiry < t) return "expired";
  const soon = new Date(today.getTime() + 180 * 86400_000).toISOString().slice(0, 10);
  return expiry <= soon ? "expiring" : "ok";
}

export function isDangerousGood(c: Pick<Chemical, "classification">) {
  return /dangerous good/i.test(c.classification);
}

export function isHazardous(c: Pick<Chemical, "classification">) {
  return /hazardous substance|dangerous good/i.test(c.classification) && !/not classified/i.test(c.classification);
}

/** dd/mm/yyyy for display and documents (NZ). */
export function nzDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Loose key for matching product names across documents and the register. */
export function productKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(formerly[^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
