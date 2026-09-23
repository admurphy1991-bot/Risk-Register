/* Seeds the database with an admin user, config lists, and the real risk
 * register data extracted from the Sansom Risk Register spreadsheet
 * (scripts/seed-risks-real.json — Tactical, Strategic-Business, and
 * Procedural sheets). Idempotent: safe to run on every deploy.
 * Run with: npm run db:seed
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema, ensureSchema } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { uid } from "../src/lib/ids";
import { computeScore } from "../src/lib/risk-scoring";

type RealRisk = {
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  ownerName: string;
  inherentLikelihood: number | null;
  inherentConsequence: number | null;
  inherentScore: number | null;
  residualLikelihood: number | null;
  residualConsequence: number | null;
  residualScore: number | null;
  statusRaw: string;
  nextReviewDate: string | null;
  controlText: string;
};

// IDs from an earlier placeholder/demo seed that predates the real import —
// removed so the real spreadsheet data isn't mixed with sample rows.
const LEGACY_PLACEHOLDER_IDS = [
  "RSK-022", "RSK-063", "RSK-031", "RSK-088", "RSK-045", "RSK-014",
  "RSK-052", "RSK-071", "RSK-97", "RSK-096", "RSK-094", "RSK-092",
  "RSK-091", "RSK-090", "RSK-095", "RSK-089", "RSK-093",
];

const CATEGORY_ALIASES: Record<string, string> = {
  "human resource": "Human Resources",
  "hr": "Human Resources",
  "environmental, safety": "Environmental & Safety",
};

function normalizeCategory(raw: string): string {
  const key = raw.trim().toLowerCase();
  return CATEGORY_ALIASES[key] || raw.trim();
}

function mapStatus(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key === "open") return "Active";
  if (key === "closed") return "Closed";
  if (key === "monitor" || key === "monitored") return "Monitored";
  if (key.includes("treatment")) return "Under treatment";
  if (key === "draft") return "Draft";
  return "Active";
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

  // --- Real risk data ---
  const jsonPath = path.join(__dirname, "seed-risks-real.json");
  const realRisks: RealRisk[] = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  // --- Categories & locations, derived from the real data ---
  const categoryNames = [...new Set(realRisks.map((r) => normalizeCategory(r.category)).filter(Boolean))].sort();
  const locationNames = [...new Set(realRisks.map((r) => r.location).filter(Boolean))].sort();

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

  // --- Remove legacy placeholder demo risks (and their controls) ---
  for (const id of LEGACY_PLACEHOLDER_IDS) {
    const existing = await db.select().from(schema.risks).where(eq(schema.risks.id, id));
    if (existing.length) {
      await db.delete(schema.controls).where(eq(schema.controls.riskId, id));
      await db.delete(schema.risks).where(eq(schema.risks.id, id));
    }
  }

  // --- Import real risks + one control each from the mitigation text ---
  const existingRisks = await db.select({ id: schema.risks.id }).from(schema.risks);
  const existingIds = new Set(existingRisks.map((r) => r.id));

  let inserted = 0;
  for (const r of realRisks) {
    if (existingIds.has(r.id)) continue;
    const inherentScore = r.inherentScore ?? computeScore(r.inherentLikelihood, r.inherentConsequence);
    const residualScore = r.residualScore ?? computeScore(r.residualLikelihood, r.residualConsequence);
    await db.insert(schema.risks).values({
      id: r.id,
      title: r.title,
      description: r.description,
      category: normalizeCategory(r.category),
      location: r.location,
      ownerName: r.ownerName,
      inherentLikelihood: r.inherentLikelihood,
      inherentConsequence: r.inherentConsequence,
      inherentScore,
      residualLikelihood: r.residualLikelihood,
      residualConsequence: r.residualConsequence,
      residualScore,
      status: mapStatus(r.statusRaw),
      nextReviewDate: r.nextReviewDate,
      source: "import",
      createdAt: now,
      updatedAt: now,
    });
    if (r.controlText) {
      await db.insert(schema.controls).values({
        id: uid("ctl"),
        riskId: r.id,
        description: r.controlText,
        type: "administrative",
        implemented: false,
        createdAt: now,
      });
    }
    inserted++;
  }
  console.log(`Seeded ${inserted} risk records from ${jsonPath} (${existingIds.size} already present).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
