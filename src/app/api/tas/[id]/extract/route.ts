import { NextRequest, NextResponse } from "next/server";
import { loadTaForRequest } from "@/lib/ta-api";
import { extractTaDetails, aiErrorMessage, type ExtractedDetails } from "@/lib/ta-ai";
import { getTaFull, logTaEvent, updateTaHeader, type TaHeaderPatch } from "@/lib/ta";

export const maxDuration = 120;

const TEXT_KEYS = [
  "jobNumber",
  "projectName",
  "taDate",
  "siteAddress",
  "mainContractor",
  "siteContactName",
  "siteContactPhone",
  "contractManager",
  "contractManagerPhone",
  "workType",
  "overview",
] as const;
const ARRAY_KEYS = ["permits", "plant", "chemicals", "ppe"] as const;

/**
 * Reads the uploaded documents with Claude and fills the project details.
 * Only fills fields that are empty or were previously AI-filled — anything a
 * person has typed is never overwritten.
 */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/tas/[id]/extract">) {
  const { id } = await ctx.params;
  const loaded = await loadTaForRequest(id, { editable: true });
  if (loaded.error) return loaded.error;
  const { user, ta } = loaded;

  let details: ExtractedDetails;
  try {
    details = await extractTaDetails(id);
  } catch (err) {
    console.error("TA extraction failed:", err);
    return NextResponse.json({ error: `Couldn't read the documents: ${aiErrorMessage(err)}` }, { status: 502 });
  }

  const aiFilled = new Set(ta.aiFilledFields);
  const patch: TaHeaderPatch = {};
  const applied: string[] = [];
  const kept: string[] = [];

  for (const key of TEXT_KEYS) {
    const value = (details[key] || "").trim();
    if (!value) continue;
    const current = (ta[key] || "").toString().trim();
    // The contract manager defaults to whoever created the TA, so treat that
    // default as replaceable.
    const replaceable = !current || aiFilled.has(key) || (key === "contractManager" && current === ta.preparedByName && !ta.contractManagerPhone);
    const isDefaultDate = key === "taDate" && current === ta.createdAt.slice(0, 10);
    if (replaceable || isDefaultDate) {
      patch[key] = value;
      applied.push(key);
    } else if (current !== value) {
      kept.push(key);
    }
  }
  for (const key of ARRAY_KEYS) {
    const value = details[key];
    if (!Array.isArray(value) || value.length === 0) continue;
    if ((ta[key] as unknown[]).length === 0 || aiFilled.has(key)) {
      (patch as Record<string, unknown>)[key] = value;
      applied.push(key);
    } else {
      kept.push(key);
    }
  }

  if (applied.length) await updateTaHeader(id, patch, { aiFilled: applied });
  await logTaEvent(id, "ai_extracted", user.name, applied.length ? `Filled: ${applied.join(", ")}` : "No new details found");

  return NextResponse.json({
    ta: await getTaFull(id),
    applied,
    kept, // fields where the documents disagree with what someone already typed
    extracted: details,
    notes: details.notes || null,
  });
}
