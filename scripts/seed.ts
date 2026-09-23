/* Seeds the database with an admin user, default categories/locations, and
 * the risk records from the user's exported CSV (scripts/seed-risks.csv).
 * Run with: npm run db:seed
 */
import fs from "node:fs";
import path from "node:path";
import { db, schema, ensureSchema } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { uid } from "../src/lib/ids";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // skip
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function ddmmyyyyToIso(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

async function main() {
  ensureSchema();
  const now = new Date().toISOString();

  // --- Admin user ---
  const email = "admin@sansom.local";
  const usersNow = await db.select().from(schema.users);
  if (!usersNow.find((u) => u.email === email)) {
    await db.insert(schema.users).values({
      id: uid("usr"),
      name: "Tony Murphy",
      email,
      passwordHash: await hashPassword("ChangeMe123!"),
      role: "admin",
      createdAt: now,
    });
    console.log(`Seeded admin user: ${email} / ChangeMe123! (change this after first login)`);
  } else {
    console.log("Admin user already exists, skipping.");
  }

  // --- Categories & locations ---
  const categoryNames = [
    "Plant and equipment",
    "Psychosocial",
    "Working at height",
    "Manual handling",
    "Hazardous substances",
    "Contractor management",
  ];
  const locationNames = [
    "Brookvale",
    "Rosehill",
    "Port Melbourne",
    "Northgate",
    "Head office",
  ];
  const existingCats = await db.select().from(schema.categories);
  for (const [i, name] of categoryNames.entries()) {
    if (!existingCats.find((c) => c.name === name)) {
      await db.insert(schema.categories).values({ id: uid("cat"), name, sortOrder: i });
    }
  }
  const existingLocs = await db.select().from(schema.locations);
  for (const [i, name] of locationNames.entries()) {
    if (!existingLocs.find((l) => l.name === name)) {
      await db.insert(schema.locations).values({ id: uid("loc"), name, sortOrder: i });
    }
  }

  // --- Risks from CSV ---
  const csvPath = path.join(__dirname, "seed-risks.csv");
  const text = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  const [header, ...data] = rows;
  const idx = (name: string) => header.findIndex((h) => h.trim().toUpperCase() === name);

  const existingRisks = await db.select({ id: schema.risks.id }).from(schema.risks);
  const existingIds = new Set(existingRisks.map((r) => r.id));

  let inserted = 0;
  for (const r of data) {
    const id = r[idx("ID")]?.trim();
    if (!id || existingIds.has(id)) continue;
    const title = r[idx("RISK")]?.trim() || "(untitled — imported)";
    const owner = r[idx("OWNER")]?.trim() || "";
    const category = r[idx("CATEGORY")]?.trim() || "";
    const location = r[idx("LOCATION")]?.trim() || "";
    const nextReview = ddmmyyyyToIso(r[idx("NEXT REVIEW")] || "");
    const inherentScore = r[idx("INHERENT SCORE")]?.trim();
    const residualScore = r[idx("RESIDUAL SCORE")]?.trim();
    const status = r[idx("STATUS")]?.trim() || "Draft";

    await db.insert(schema.risks).values({
      id,
      title,
      description: "",
      category,
      location,
      ownerName: owner,
      inherentLikelihood: null,
      inherentConsequence: null,
      inherentScore: inherentScore ? parseInt(inherentScore, 10) : null,
      residualLikelihood: null,
      residualConsequence: null,
      residualScore: residualScore ? parseInt(residualScore, 10) : null,
      status,
      nextReviewDate: nextReview,
      source: "import",
      createdAt: now,
      updatedAt: now,
    });
    inserted++;
  }
  console.log(`Seeded ${inserted} risk records from ${csvPath} (${existingIds.size} already present).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
