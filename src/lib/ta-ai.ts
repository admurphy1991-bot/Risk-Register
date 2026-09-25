import Anthropic from "@anthropic-ai/sdk";
import { db, schema } from "@/lib/db";
import { riskControlStatements } from "@/lib/controls";
import { loadTaFilesForAi } from "@/lib/ta-files";
import { PPE_OPTIONS, type TaHeader, type StepInput, type PlantItem, type ChemicalItem } from "@/lib/ta";

// Two Claude calls power the TA builder:
//  1. extractTaDetails — reads the dropped-in proposal / scope / emails and
//     fills the project-details fields of the TA.
//  2. suggestTaSteps — drafts job steps and, for each, links the applicable
//     Sansom register risks and pre-selects their relevant controls.
// Both use a forced tool call so the output is structured JSON, never prose.

export class AiConfigError extends Error {}

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiConfigError("ANTHROPIC_API_KEY is not configured on the server.");
  return new Anthropic({ apiKey });
}

function model() {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
}

export function aiErrorMessage(err: unknown): string {
  if (err instanceof AiConfigError) return err.message;
  if (err instanceof Anthropic.APIError) return `${err.status ?? ""} ${err.name}: ${err.message}`.trim();
  return err instanceof Error ? err.message : String(err);
}

async function sourceBlocks(taId: string): Promise<{ blocks: Anthropic.ContentBlockParam[]; count: number }> {
  const files = await loadTaFilesForAi(taId);
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const f of files) {
    if (f.kind === "text" && f.text) {
      blocks.push({ type: "text", text: `<document filename="${f.filename}">\n${f.text}\n</document>` });
    } else if (f.kind === "pdf" && f.base64) {
      blocks.push({ type: "text", text: `The next document is "${f.filename}".` });
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } });
    } else if (f.kind === "image" && f.base64) {
      blocks.push({ type: "text", text: `The next image is "${f.filename}".` });
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: f.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: f.base64 },
      });
    }
  }
  return { blocks, count: files.length };
}

function forcedToolInput<T>(response: Anthropic.Message, toolName: string): T {
  const use = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === toolName);
  if (!use) throw new Error("The AI didn't return structured output — please try again.");
  return use.input as T;
}

// ---------------------------------------------------------------------------
// 1. Project details extraction
// ---------------------------------------------------------------------------

export type ExtractedDetails = {
  jobNumber?: string;
  projectName?: string;
  taDate?: string;
  siteAddress?: string;
  mainContractor?: string;
  siteContactName?: string;
  siteContactPhone?: string;
  contractManager?: string;
  contractManagerPhone?: string;
  workType?: string;
  overview?: string;
  permits?: string[];
  plant?: PlantItem[];
  chemicals?: ChemicalItem[];
  ppe?: string[];
  notes?: string;
};

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "record_ta_details",
  description: "Record the project details for the Task Analysis, taken only from the supplied documents.",
  input_schema: {
    type: "object",
    properties: {
      jobNumber: { type: "string", description: "Sansom job / quote number, e.g. S34144. Empty if not stated." },
      projectName: { type: "string", description: "Short project name in capitals, e.g. 'THE GALLERIES 23 GRAHAM ST WATERPROOFING REMEDIATION WORKS'. Do not repeat the job number." },
      taDate: { type: "string", description: "Planned start / TA date as YYYY-MM-DD if stated; otherwise empty." },
      siteAddress: { type: "string", description: "Street address / location of the works." },
      mainContractor: { type: "string", description: "Main contractor or client (e.g. body corporate) Sansom is working for." },
      siteContactName: { type: "string", description: "Client / main contractor site contact person (name and role)." },
      siteContactPhone: { type: "string" },
      contractManager: { type: "string", description: "Sansom contract / project manager for the job." },
      contractManagerPhone: { type: "string" },
      workType: { type: "string", description: "One sentence: the type of work, e.g. 'Waterproofing remediation works to selected Ground Floor and Level 4 areas.'" },
      overview: {
        type: "string",
        description:
          "Overview of the work as it would read in a TA: 2-5 sentences starting 'Sansom Construction Systems will undertake…', listing each distinct work area / activity, access method and products named in the documents, and any stated exclusions.",
      },
      permits: {
        type: "array",
        items: { type: "string" },
        description: "Permits the work will need, e.g. 'Working at Height Permit', 'Hot Work Permit', 'Site Permit to Work'. Include those clearly implied by the scope (e.g. torching membrane -> Hot Work Permit).",
      },
      plant: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: { type: "string", description: "Plant / equipment, e.g. 'Vertical lifter / MEWP'." },
            operatorRequirements: { type: "string", description: "Competency / checks required to use it." },
          },
          required: ["item"],
        },
      },
      chemicals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Product name as written, e.g. 'SikaRoof i-Cure 22 system'." },
            sds: { type: "string", description: "SDS availability — default 'SDS available onsite'." },
          },
          required: ["name"],
        },
      },
      ppe: {
        type: "array",
        items: { type: "string", enum: PPE_OPTIONS.map((p) => p.key) },
        description: "PPE the work requires.",
      },
      notes: {
        type: "string",
        description: "Anything the project manager should double-check: conflicting details between documents, assumptions made, or important fields you could not find.",
      },
    },
  },
};

export async function extractTaDetails(taId: string): Promise<ExtractedDetails> {
  const { blocks, count } = await sourceBlocks(taId);
  if (count === 0) throw new Error("Upload at least one supporting document first.");

  const response = await client().messages.create({
    model: model(),
    max_tokens: 3000,
    system:
      "You help Sansom Construction Systems (a New Zealand concrete repair and waterproofing contractor) prepare Task Analysis / Safe Work Method Statement (TA/SWMS) documents. You extract project details from proposals, quotes, scopes of work, emails and site notes. Only record information supported by the documents — never invent names, phone numbers, addresses or job numbers. Leave a field empty rather than guess.",
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          ...blocks,
          {
            type: "text",
            text: "From the documents above, record the project details for this job's Task Analysis using the record_ta_details tool.",
          },
        ],
      },
    ],
  });

  const raw = forcedToolInput<ExtractedDetails>(response, EXTRACT_TOOL.name);
  const validPpe = new Set(PPE_OPTIONS.map((p) => p.key));
  return {
    ...raw,
    taDate: raw.taDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.taDate) ? raw.taDate : undefined,
    ppe: (raw.ppe || []).filter((p) => validPpe.has(p)),
    plant: (raw.plant || []).filter((p) => p?.item).map((p) => ({ item: p.item, operatorRequirements: p.operatorRequirements || "" })),
    chemicals: (raw.chemicals || []).filter((c) => c?.name).map((c) => ({ name: c.name, sds: c.sds || "SDS available onsite" })),
  };
}

// ---------------------------------------------------------------------------
// 2. Job steps, register risks and controls
// ---------------------------------------------------------------------------

type RegisterCatalogue = {
  text: string;
  controlIndex: Map<string, { riskId: string; text: string }>;
  risks: Map<string, typeof schema.risks.$inferSelect>;
};

async function buildRegisterCatalogue(): Promise<RegisterCatalogue> {
  const risks = (await db.select().from(schema.risks)).filter((r) => r.status !== "Closed");
  const controls = await db.select().from(schema.controls);
  const controlsByRisk: Record<string, { description: string }[]> = {};
  for (const c of controls) (controlsByRisk[c.riskId] ||= []).push(c);

  // Site-level (tactical) and procedural risks first — they're what a TA
  // step usually needs; strategic/business risks come last.
  const rank = (loc: string) => (loc.startsWith("Tactical") ? 0 : loc.startsWith("Procedural") ? 1 : 2);
  risks.sort((a, b) => rank(a.location) - rank(b.location) || a.id.localeCompare(b.id, undefined, { numeric: true }));

  const controlIndex = new Map<string, { riskId: string; text: string }>();
  const lines: string[] = [];
  for (const r of risks) {
    const statements = riskControlStatements(controlsByRisk[r.id]);
    const desc = r.description.length > 220 ? `${r.description.slice(0, 220)}…` : r.description;
    lines.push(
      `[${r.id}] ${r.title} — ${r.category || "Uncategorised"}; ${r.location || "—"}; inherent L${r.inherentLikelihood ?? "?"}xC${r.inherentConsequence ?? "?"}=${r.inherentScore ?? "?"}, residual L${r.residualLikelihood ?? "?"}xC${r.residualConsequence ?? "?"}=${r.residualScore ?? "?"}`
    );
    if (desc) lines.push(`  Hazards: ${desc}`);
    statements.forEach((s, i) => {
      const cid = `${r.id}.c${i}`;
      controlIndex.set(cid, { riskId: r.id, text: s });
      lines.push(`  ${cid}: ${s}`);
    });
  }
  return { text: lines.join("\n"), controlIndex, risks: new Map(risks.map((r) => [r.id, r])) };
}

type ProposedStep = {
  description: string;
  identifiedRisks?: string[];
  registerRiskIds?: string[];
  controlIds?: string[];
  additionalControls?: string[];
  initialLikelihood?: number;
  initialConsequence?: number;
  residualLikelihood?: number;
  residualConsequence?: number;
};

const STEPS_TOOL: Anthropic.Tool = {
  name: "propose_job_steps",
  description: "Propose the job steps for the TA, each with its identified risks, linked register risks, selected controls and ratings.",
  input_schema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "The job step, e.g. 'MEWP / vertical lifter access to Southern Courtyard Gutter'. Keep under ~12 words." },
            identifiedRisks: {
              type: "array",
              items: { type: "string" },
              description: "What could result in harm in this step — short phrases, e.g. 'Fall from height', 'Dropped tools/materials', 'Plant people interface'. 2-6 items.",
            },
            registerRiskIds: { type: "array", items: { type: "string" }, description: "IDs of the Sansom register risks this step draws on, e.g. ['TAC-33','TAC-16']." },
            controlIds: {
              type: "array",
              items: { type: "string" },
              description: "IDs of register control statements (e.g. 'TAC-33.c3') that apply to THIS step on THIS job. Choose the relevant ones — not every control of the risk.",
            },
            additionalControls: {
              type: "array",
              items: { type: "string" },
              description: "Job-specific controls not covered by the register statements (e.g. naming the actual product, area or permit). Imperative, one line each.",
            },
            initialLikelihood: { type: "integer", minimum: 1, maximum: 5 },
            initialConsequence: { type: "integer", minimum: 1, maximum: 5 },
            residualLikelihood: { type: "integer", minimum: 1, maximum: 5 },
            residualConsequence: { type: "integer", minimum: 1, maximum: 5 },
          },
          required: ["description", "identifiedRisks", "registerRiskIds", "controlIds"],
        },
      },
    },
    required: ["steps"],
  },
};

function headerSummary(ta: TaHeader): string {
  const lines = [
    `Job: ${[ta.jobNumber, ta.projectName].filter(Boolean).join(" - ") || "(not set)"}`,
    `Location: ${ta.siteAddress || "(not set)"}`,
    `Main contractor: ${ta.mainContractor || "(not set)"}`,
    `Work type: ${ta.workType || "(not set)"}`,
    `Overview: ${ta.overview || "(not set)"}`,
    `Permits: ${ta.permits.join("; ") || "(none listed)"}`,
    `Plant & equipment: ${ta.plant.map((p) => p.item).join("; ") || "(none listed)"}`,
    `Chemicals / hazardous substances: ${ta.chemicals.map((c) => c.name).join("; ") || "(none listed)"}`,
  ];
  return lines.join("\n");
}

export async function suggestTaSteps(ta: TaHeader, opts: { focus?: string } = {}): Promise<StepInput[]> {
  const catalogue = await buildRegisterCatalogue();
  const { blocks } = await sourceBlocks(ta.id);

  const response = await client().messages.create({
    model: model(),
    max_tokens: 8000,
    system: [
      {
        type: "text",
        text: `You help Sansom Construction Systems (a New Zealand concrete repair and waterproofing contractor) build Task Analysis / Safe Work Method Statements (TA/SWMS).

A TA lists the job steps in the order the work is performed — typically starting with pre-planning / scope review and site arrival / induction, then setting up controlled work areas, access, each distinct work activity, chemical handling, QA / hold points, clean up and handover. Each step records the identified risks, an initial risk rating, the control measures, and a residual risk rating.

Sansom's risk matrix: likelihood 1 Rare, 2 Unlikely, 3 Possible, 4 Likely, 5 Almost Certain; consequence 1 Minor, 2 Medium, 3 Serious, 4 Major, 5 Catastrophic. Score = likelihood x consequence. Bands: 1-3 Low, 4-6 Moderate, 8-12 High, 15-25 Critical. Residual ratings should reflect the controls chosen and must not exceed the initial rating. Controls typically reduce likelihood, rarely consequence.

Rules:
- Link each step to the Sansom register risks below that genuinely apply, and select the specific control statements (by ID) that apply to that step on this job. Prefer register controls; add additionalControls only for job-specific specifics (products, areas, permits, access methods named in the documents).
- Only use risk IDs and control IDs that appear in the register below.
- Aim for roughly 8-16 steps, matching the scale of the job.

SANSOM RISK REGISTER (risk ID, title, category, level, ratings, hazards, then control statement IDs):
${catalogue.text}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [STEPS_TOOL],
    tool_choice: { type: "tool", name: STEPS_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          ...blocks,
          {
            type: "text",
            text: `Project details for this TA:\n${headerSummary(ta)}${
              opts.focus ? `\n\nThe project manager adds: ${opts.focus}` : ""
            }\n\nPropose the job steps for this TA with the propose_job_steps tool.`,
          },
        ],
      },
    ],
  });

  const raw = forcedToolInput<{ steps: ProposedStep[] }>(response, STEPS_TOOL.name);
  return (raw.steps || [])
    .filter((s) => s?.description)
    .map((s) => {
      const riskIds = [...new Set((s.registerRiskIds || []).filter((id) => catalogue.risks.has(id)))];
      const controls: { text: string; riskId: string | null }[] = [];
      const seen = new Set<string>();
      for (const cid of s.controlIds || []) {
        const c = catalogue.controlIndex.get(cid);
        if (c && !seen.has(c.text.toLowerCase())) {
          seen.add(c.text.toLowerCase());
          controls.push({ text: c.text, riskId: c.riskId });
          if (!riskIds.includes(c.riskId)) riskIds.push(c.riskId);
        }
      }
      for (const text of s.additionalControls || []) {
        const t = String(text || "").trim();
        if (t && !seen.has(t.toLowerCase())) {
          seen.add(t.toLowerCase());
          controls.push({ text: t, riskId: null });
        }
      }

      // Fall back to the register's own ratings when the model omits them.
      const linked = riskIds.map((id) => catalogue.risks.get(id)!).filter(Boolean);
      const worst = (pick: (r: (typeof linked)[number]) => [number | null, number | null]) =>
        linked
          .map(pick)
          .filter((p): p is [number, number] => p[0] !== null && p[1] !== null)
          .sort((a, b) => b[0] * b[1] - a[0] * a[1])[0] ?? [null, null];
      const [il, ic] = s.initialLikelihood && s.initialConsequence ? [s.initialLikelihood, s.initialConsequence] : worst((r) => [r.inherentLikelihood, r.inherentConsequence]);
      let [rl, rc] = s.residualLikelihood && s.residualConsequence ? [s.residualLikelihood, s.residualConsequence] : worst((r) => [r.residualLikelihood, r.residualConsequence]);
      if (il && ic && rl && rc && rl * rc > il * ic) [rl, rc] = [il, ic];

      return {
        description: s.description.trim(),
        identifiedRisks: (s.identifiedRisks || []).map((x) => String(x).trim()).filter(Boolean),
        riskIds,
        controls,
        initialLikelihood: il,
        initialConsequence: ic,
        residualLikelihood: rl,
        residualConsequence: rc,
      };
    });
}
