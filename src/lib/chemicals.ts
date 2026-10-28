import fs from "node:fs/promises";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { db, schema, sqlite, dataDir } from "@/lib/db";
import { defaultSdsExpiry, productKey, type Chemical } from "@/lib/chemicals-shared";

export * from "@/lib/chemicals-shared";

// Chemical register: Sansom's hazardous substances, mastered in Donesafe.
// The Donesafe "Chemical register" CSV export is the import format — Record
// ID is the key, so re-importing a newer export updates the register.

type Row = typeof schema.chemicals.$inferSelect;

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function mapChemical(r: Row): Chemical {
  return {
    id: r.id,
    productName: r.productName,
    status: r.status,
    unNumber: r.unNumber,
    classification: r.classification,
    hazards: parseJson<string[]>(r.hazards, []),
    location: r.location,
    sdsFilename: r.sdsFilename,
    sdsDate: r.sdsDate,
    sdsExpiry: r.sdsExpiry || defaultSdsExpiry(r.sdsDate),
    hasSdsFile: !!r.sdsStoredPath,
    notes: r.notes,
    source: r.source,
    externalCreatedAt: r.externalCreatedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function listChemicals(): Promise<Chemical[]> {
  const rows = await db.select().from(schema.chemicals).orderBy(asc(schema.chemicals.productName));
  return rows.map(mapChemical);
}

export async function getChemical(id: string) {
  const rows = await db.select().from(schema.chemicals).where(eq(schema.chemicals.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getChemicalsByIds(ids: string[]): Promise<Chemical[]> {
  if (!ids.length) return [];
  const all = await listChemicals();
  const byId = new Map(all.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is Chemical => !!c);
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export type ChemicalInput = Partial<{
  productName: string;
  status: string;
  unNumber: string;
  classification: string;
  hazards: string[];
  location: string;
  sdsFilename: string;
  sdsDate: string | null;
  sdsExpiry: string | null;
  notes: string;
}>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function cleanInput(input: ChemicalInput) {
  const out: Record<string, unknown> = {};
  for (const k of ["productName", "status", "unNumber", "classification", "location", "sdsFilename", "notes"] as const) {
    if (typeof input[k] === "string") out[k] = (input[k] as string).trim();
  }
  if (Array.isArray(input.hazards)) out.hazards = JSON.stringify(input.hazards.map((h) => String(h).trim()).filter(Boolean));
  for (const k of ["sdsDate", "sdsExpiry"] as const) {
    if (k in input) out[k] = input[k] && ISO.test(input[k]!) ? input[k] : null;
  }
  return out;
}

/** Next id for a chemical added in this app (not yet in Donesafe). */
async function nextLocalId() {
  const rows = await db.select({ id: schema.chemicals.id }).from(schema.chemicals);
  let max = 0;
  for (const r of rows) {
    const m = /^CHE-L(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `CHE-L${String(max + 1).padStart(3, "0")}`;
}

export async function createChemical(input: ChemicalInput, source: "manual" | "ai" = "manual") {
  const name = (input.productName || "").trim();
  if (!name) throw new Error("Product name is required.");
  const id = await nextLocalId();
  const ts = new Date().toISOString();
  await db.insert(schema.chemicals).values({
    id,
    productName: name,
    status: "Draft",
    source,
    createdAt: ts,
    updatedAt: ts,
    ...cleanInput(input),
  });
  return id;
}

export async function updateChemical(id: string, input: ChemicalInput) {
  const set = cleanInput(input);
  if ("productName" in set && !set.productName) throw new Error("Product name can't be empty.");
  await db
    .update(schema.chemicals)
    .set({ ...set, updatedAt: new Date().toISOString() })
    .where(eq(schema.chemicals.id, id));
}

export async function deleteChemical(id: string) {
  const row = await getChemical(id);
  if (row?.sdsStoredPath) await fs.rm(row.sdsStoredPath, { force: true });
  await db.delete(schema.chemicals).where(eq(schema.chemicals.id, id));
}

// ---------------------------------------------------------------------------
// SDS files
// ---------------------------------------------------------------------------

export const MAX_SDS_BYTES = 20 * 1024 * 1024;

export async function storeSds(id: string, file: File) {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") throw new Error("Upload the SDS as a PDF.");
  if (file.size > MAX_SDS_BYTES) throw new Error("SDS PDFs are limited to 20 MB.");
  if (!/^[\w-]+$/.test(id)) throw new Error("Invalid chemical id");
  const dir = path.join(dataDir, "sds");
  await fs.mkdir(dir, { recursive: true });
  const stored = path.join(dir, `${id}.pdf`);
  await fs.writeFile(stored, Buffer.from(await file.arrayBuffer()));
  const row = await getChemical(id);
  await db
    .update(schema.chemicals)
    .set({ sdsStoredPath: stored, sdsFilename: row?.sdsFilename || file.name, updatedAt: new Date().toISOString() })
    .where(eq(schema.chemicals.id, id));
}

export async function removeSds(id: string) {
  const row = await getChemical(id);
  if (row?.sdsStoredPath) await fs.rm(row.sdsStoredPath, { force: true });
  await db.update(schema.chemicals).set({ sdsStoredPath: null, updatedAt: new Date().toISOString() }).where(eq(schema.chemicals.id, id));
}

// ---------------------------------------------------------------------------
// Donesafe CSV import
// ---------------------------------------------------------------------------

/** RFC 4180-ish CSV parser (quoted fields, embedded commas/newlines, ""). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** "8/07/2026" or "13/03/2024 13:23" (NZ day-first) → ISO date. */
export function nzToIso(v: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v.trim());
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim().slice(0, 10);
  return null;
}

function nzToIsoDateTime(v: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(v.trim());
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${(m[4] || "0").padStart(2, "0")}:${m[5] || "00"}:00`;
}

// Donesafe column headings → our fields (matched case-insensitively, by prefix).
const COLUMN_MATCHERS: [keyof ImportRow, RegExp][] = [
  ["id", /^record id$/i],
  ["status", /^status$/i],
  ["productName", /^product name$/i],
  ["unNumber", /^un number$/i],
  ["sdsFilename", /^sds$/i],
  ["sdsDate", /^sds date$/i],
  ["sdsExpiry", /^sds expir/i],
  ["classification", /^is the product hazardous/i],
  ["createdAt", /^created at$/i],
  ["hazards", /^hazard posed/i],
  ["location", /^location$/i],
];

type ImportRow = {
  id: string;
  status: string;
  productName: string;
  unNumber: string;
  sdsFilename: string;
  sdsDate: string;
  sdsExpiry: string;
  classification: string;
  createdAt: string;
  hazards: string;
  location: string;
};

export type ImportResult = { created: number; updated: number; unchanged: number; linked: number; skipped: string[]; total: number };

/**
 * Upserts a Donesafe chemical-register CSV. Matches on Record ID; a chemical
 * that was added here first (CHE-L###) and has since been entered in
 * Donesafe is matched by product name and takes over the Donesafe ID (SSSPs
 * that reference it are updated). `insertOnly` leaves existing rows alone
 * (used by the seed so it never overwrites edits).
 */
export function importChemicalsCsv(text: string, opts: { insertOnly?: boolean } = {}): ImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The file has no data rows.");
  const header = rows[0].map((h) => h.trim());
  const index: Partial<Record<keyof ImportRow, number>> = {};
  for (const [key, re] of COLUMN_MATCHERS) {
    const i = header.findIndex((h) => re.test(h));
    if (i >= 0) index[key] = i;
  }
  if (index.id === undefined || index.productName === undefined) {
    throw new Error("This doesn't look like a Donesafe chemical register export — it needs 'Record ID' and 'Product name' columns.");
  }

  const existing = sqlite.prepare(`SELECT * FROM chemicals`).all() as Record<string, string | null>[];
  const byId = new Map(existing.map((r) => [r.id as string, r]));
  const localByName = new Map(
    existing.filter((r) => /^CHE-L/.test(r.id as string)).map((r) => [productKey(r.product_name as string), r])
  );

  const ts = new Date().toISOString();
  const insert = sqlite.prepare(
    `INSERT INTO chemicals (id, product_name, status, un_number, classification, hazards, location, sds_filename, sds_date, sds_expiry, source, external_created_at, created_at, updated_at)
     VALUES (@id, @productName, @status, @unNumber, @classification, @hazards, @location, @sdsFilename, @sdsDate, @sdsExpiry, 'donesafe', @externalCreatedAt, @ts, @ts)`
  );
  const update = sqlite.prepare(
    `UPDATE chemicals SET product_name=@productName, status=@status, un_number=@unNumber, classification=@classification, hazards=@hazards,
       location=@location, sds_filename=@sdsFilename, sds_date=@sdsDate, sds_expiry=@sdsExpiry, source='donesafe', external_created_at=@externalCreatedAt, updated_at=@ts
     WHERE id=@id`
  );
  const rename = sqlite.prepare(`UPDATE chemicals SET id=@newId WHERE id=@oldId`);

  const result: ImportResult = { created: 0, updated: 0, unchanged: 0, linked: 0, skipped: [], total: rows.length - 1 };
  const renames: [string, string][] = [];
  const get = (r: string[], k: keyof ImportRow) => (index[k] !== undefined ? (r[index[k]!] ?? "").trim() : "");

  const tx = sqlite.transaction(() => {
    for (const r of rows.slice(1)) {
      const id = get(r, "id");
      const productName = get(r, "productName");
      if (!id || !productName) {
        result.skipped.push(productName || id || "(blank row)");
        continue;
      }
      const sdsDate = nzToIso(get(r, "sdsDate"));
      const rec = {
        id,
        productName,
        status: get(r, "status") || "Approved for Use",
        unNumber: get(r, "unNumber"),
        classification: get(r, "classification"),
        hazards: JSON.stringify(
          get(r, "hazards")
            .split(",")
            .map((h) => h.trim())
            .filter(Boolean)
        ),
        location: get(r, "location"),
        sdsFilename: get(r, "sdsFilename"),
        sdsDate,
        sdsExpiry: nzToIso(get(r, "sdsExpiry")) || defaultSdsExpiry(sdsDate),
        externalCreatedAt: nzToIsoDateTime(get(r, "createdAt")),
        ts,
      };

      let current = byId.get(id);
      if (!current) {
        const local = localByName.get(productKey(productName));
        if (local) {
          rename.run({ newId: id, oldId: local.id });
          renames.push([local.id as string, id]);
          localByName.delete(productKey(productName));
          current = { ...local, id };
          result.linked++;
        }
      }
      if (!current) {
        insert.run(rec);
        result.created++;
      } else if (opts.insertOnly) {
        result.unchanged++;
      } else {
        const same =
          current.product_name === rec.productName &&
          current.status === rec.status &&
          current.un_number === rec.unNumber &&
          current.classification === rec.classification &&
          current.hazards === rec.hazards &&
          current.location === rec.location &&
          current.sds_filename === rec.sdsFilename &&
          current.sds_date === rec.sdsDate &&
          current.sds_expiry === rec.sdsExpiry;
        if (same) result.unchanged++;
        else {
          update.run(rec);
          result.updated++;
        }
      }
    }

    // Point SSSPs at the Donesafe IDs of chemicals that were renamed.
    if (renames.length) {
      const sssps = sqlite.prepare(`SELECT id, data FROM sssps`).all() as { id: string; data: string }[];
      const setData = sqlite.prepare(`UPDATE sssps SET data=? WHERE id=?`);
      const map = new Map(renames);
      for (const s of sssps) {
        try {
          const d = JSON.parse(s.data);
          if (Array.isArray(d.chemicalIds) && d.chemicalIds.some((c: string) => map.has(c))) {
            d.chemicalIds = d.chemicalIds.map((c: string) => map.get(c) ?? c);
            if (d.chemicalReasons) for (const [o, n] of renames) if (d.chemicalReasons[o]) d.chemicalReasons[n] = d.chemicalReasons[o];
            setData.run(JSON.stringify(d), s.id);
          }
        } catch {
          /* leave malformed rows alone */
        }
      }
    }
  });
  tx();
  return result;
}

/** Compact catalogue of approved chemicals for the AI (id, name, UN, class). */
export async function chemicalCatalogue(): Promise<{ text: string; ids: Set<string> }> {
  const rows = (await listChemicals()).filter((c) => c.status !== "No Longer in Use");
  return {
    text: rows.map((c) => `[${c.id}] ${c.productName}${c.unNumber && c.unNumber !== "Not Classified" ? ` (${c.unNumber})` : ""}${c.status === "Draft" ? " — draft" : ""}`).join("\n"),
    ids: new Set(rows.map((c) => c.id)),
  };
}
