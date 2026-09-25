import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import { db, schema, dataDir } from "@/lib/db";
import { eq } from "drizzle-orm";
import { uid } from "@/lib/ids";

// Supporting documents dropped into "Create TA". PDFs and images are sent to
// Claude natively (it reads them directly); Word docs, emails and text files
// are converted to plain text first.

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // PDFs up to the API's request limit
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // API limit per image
export const MAX_FILES_PER_TA = 12;
const MAX_TEXT_CHARS = 60_000;

type Kind = "pdf" | "image" | "docx" | "text";

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const TEXT_EXT = new Set([".txt", ".md", ".csv", ".eml", ".json", ".htm", ".html"]);

export function classifyFile(filename: string, mimeType: string): { kind: Kind; mimeType: string } | { error: string } {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf" || mimeType === "application/pdf") return { kind: "pdf", mimeType: "application/pdf" };
  if (IMAGE_TYPES[ext]) return { kind: "image", mimeType: IMAGE_TYPES[ext] };
  if (ext === ".docx") {
    return { kind: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  }
  if (TEXT_EXT.has(ext) || mimeType.startsWith("text/")) return { kind: "text", mimeType: mimeType || "text/plain" };
  if (ext === ".msg") return { error: `${filename}: Outlook .msg files aren't supported yet — save the email as PDF (File → Print → PDF) or drag it out as .eml.` };
  if (ext === ".doc") return { error: `${filename}: old .doc format isn't supported — save it as .docx or PDF.` };
  if (ext === ".xlsx" || ext === ".xls") return { error: `${filename}: spreadsheets aren't supported yet — export the relevant sheet as PDF or CSV.` };
  return { error: `${filename}: unsupported file type. Use PDF, Word (.docx), email (.eml), text, or an image.` };
}

function safeName(name: string) {
  return name.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").slice(0, 120) || "file";
}

function taDir(taId: string) {
  if (!/^TA-\d+$/.test(taId)) throw new Error("Invalid TA id");
  return path.join(dataDir, "ta-files", taId);
}

function cleanText(text: string) {
  return text
    .split(/\r?\n/)
    // Drop long unbroken lines — base64 attachments inside .eml files etc.
    .filter((line) => !(line.length > 120 && !/\s/.test(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

async function extractText(kind: Kind, buf: Buffer): Promise<string | null> {
  if (kind === "docx") {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return cleanText(value);
  }
  if (kind === "text") {
    let text = buf.toString("utf8");
    if (/<html[\s>]/i.test(text)) text = text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ");
    return cleanText(text);
  }
  return null; // PDFs and images are read natively by the model
}

export async function storeTaFile(taId: string, file: File) {
  const classified = classifyFile(file.name, file.type);
  if ("error" in classified) throw new Error(classified.error);
  const limit = classified.kind === "image" ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
  if (file.size > limit) {
    throw new Error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${limit / 1024 / 1024} MB for this file type.`);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const id = uid("tfl");
  const dir = taDir(taId);
  await fs.mkdir(dir, { recursive: true });
  const storedPath = path.join(dir, `${id}-${safeName(file.name)}`);
  await fs.writeFile(storedPath, buf);

  let extractedText: string | null = null;
  try {
    extractedText = await extractText(classified.kind, buf);
  } catch (err) {
    await fs.rm(storedPath, { force: true });
    throw new Error(`Couldn't read ${file.name}: ${(err as Error).message}`);
  }

  const row = {
    id,
    taId,
    filename: file.name,
    mimeType: classified.mimeType,
    sizeBytes: file.size,
    storedPath,
    extractedText,
    createdAt: new Date().toISOString(),
  };
  await db.insert(schema.taFiles).values(row);
  return { id, filename: row.filename, mimeType: row.mimeType, sizeBytes: row.sizeBytes, createdAt: row.createdAt, hasText: !!extractedText };
}

export async function deleteTaFile(taId: string, fileId: string) {
  const rows = await db.select().from(schema.taFiles).where(eq(schema.taFiles.id, fileId)).limit(1);
  const row = rows[0];
  if (!row || row.taId !== taId) return false;
  await fs.rm(row.storedPath, { force: true });
  await db.delete(schema.taFiles).where(eq(schema.taFiles.id, fileId));
  return true;
}

export async function deleteAllTaFiles(taId: string) {
  await fs.rm(taDir(taId), { recursive: true, force: true });
}

/** Loads a TA's files in the shape the AI extraction step needs. */
export async function loadTaFilesForAi(taId: string) {
  const rows = await db.select().from(schema.taFiles).where(eq(schema.taFiles.taId, taId));
  const out: { filename: string; kind: "pdf" | "image" | "text"; mimeType: string; base64?: string; text?: string }[] = [];
  for (const r of rows) {
    if (r.extractedText) {
      out.push({ filename: r.filename, kind: "text", mimeType: r.mimeType, text: r.extractedText });
    } else if (r.mimeType === "application/pdf" || r.mimeType.startsWith("image/")) {
      try {
        const buf = await fs.readFile(r.storedPath);
        out.push({
          filename: r.filename,
          kind: r.mimeType === "application/pdf" ? "pdf" : "image",
          mimeType: r.mimeType,
          base64: buf.toString("base64"),
        });
      } catch {
        // File missing on disk (e.g. ephemeral storage) — skip it.
      }
    }
  }
  return out;
}
