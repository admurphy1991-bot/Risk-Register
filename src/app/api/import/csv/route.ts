import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyChangePlan, type ChangeOpInput } from "@/lib/change-log";

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
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // skip
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const HEADER_MAP: Record<string, string> = {
  title: "title",
  risk: "title",
  description: "description",
  category: "category",
  location: "location",
  owner: "ownerName",
  ownername: "ownerName",
  status: "status",
  nextreview: "nextReviewDate",
  nextreviewdate: "nextReviewDate",
};

/**
 * Accepts a CSV upload (same shape as the register's own export, or a close
 * variant — headers are matched loosely) and stages every row as one change
 * plan, so an import is reviewed and applied like anything else.
 */
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Upload a CSV file under the 'file' field." }, { status: 400 });
  }
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return NextResponse.json({ error: "CSV has no data rows." }, { status: 400 });

  const [header, ...data] = rows;
  const normalizedHeader = header.map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ""));

  const changes: ChangeOpInput[] = [];
  for (const r of data) {
    const record: Record<string, string> = {};
    normalizedHeader.forEach((h, i) => {
      const field = HEADER_MAP[h];
      if (field) record[field] = (r[i] || "").trim();
    });
    if (!record.title) continue;
    changes.push({
      op: "create_risk",
      data: {
        title: record.title,
        description: record.description,
        category: record.category,
        location: record.location,
        ownerName: record.ownerName,
        status: record.status || "Draft",
        nextReviewDate: record.nextReviewDate || null,
      },
    });
  }

  if (!changes.length) {
    return NextResponse.json({ error: "No valid rows found (need at least a title/risk column)." }, { status: 400 });
  }

  const { planId, applied } = await applyChangePlan({
    actorType: "import",
    actorName: user.name,
    summary: `Imported ${changes.length} risk(s) from CSV`,
    changes,
  });

  return NextResponse.json({ planId, imported: applied.length });
}
