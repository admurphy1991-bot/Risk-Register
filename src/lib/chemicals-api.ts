import fs from "node:fs";
import path from "node:path";
import { sqlite } from "@/lib/db";
import { importChemicalsCsv } from "@/lib/chemicals";
import type { SessionUser } from "@/lib/auth";

/** Admins and H&S maintain the register; anyone can add a draft entry. */
export function canEditChemicals(user: SessionUser) {
  return user.role === "admin" || user.role === "hs";
}

let ensured = false;
/**
 * Loads the bundled Donesafe export the first time the register is opened on
 * an empty database (so a deploy that doesn't run the seed still has data).
 */
export function ensureChemicalsSeeded() {
  if (ensured) return;
  ensured = true;
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM chemicals`).get() as { n: number };
  if (row.n > 0) return;
  const file = path.join(process.cwd(), /* turbopackIgnore: true */ "scripts", "seed-chemicals.csv");
  if (!fs.existsSync(file)) return;
  try {
    importChemicalsCsv(fs.readFileSync(file, "utf8"), { insertOnly: true });
  } catch (err) {
    console.error("Chemical register seed failed:", err);
  }
}
