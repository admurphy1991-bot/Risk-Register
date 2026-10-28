import Anthropic from "@anthropic-ai/sdk";
import { db, schema } from "@/lib/db";
import { client, model, sourceBlocks, forcedToolInput } from "@/lib/ta-ai";
import { getTaFull } from "@/lib/ta";
import { chemicalCatalogue } from "@/lib/chemicals";
import { NOTIFIABLE_WORKS, QUESTIONS, WORK_TYPES, type AnswerOption } from "@/lib/sssp-shared";
import type { SsspHeader } from "@/lib/sssp";

// "Build SSSP with AI": one Claude call reads the job's documents and linked
// TAs, and drafts every job-specific part of the SSSP — project info, work
// types, the YES/N/A decisions, environmental controls, notifiable works,
// the emergency response plan, which register risks apply, and which
// chemical-register products will be on site. Sansom's standard answers
// (PPE, site rules, communications…) stay as the template sets them.

const AI_QUESTIONS = QUESTIONS.filter((q) => q.ai);

export type SsspDraft = {
  jobNumber?: string;
  projectName?: string;
  siteAddress?: string;
  mainContractor?: string;
  clientContactName?: string;
  clientContactPhone?: string;
  projectManager?: string;
  projectManagerPhone?: string;
  startDate?: string;
  endDate?: string;
  workTypes?: string[];
  scope?: string;
  subcontractedWorks?: string;
  answers?: Record<string, AnswerOption>;
  controls?: { dust?: string; noise?: string; water?: string };
  notifiableWorks?: string[];
  notifiableOther?: string;
  emergency?: Partial<Record<"assemblyPoint" | "hospital" | "hospitalPhone" | "emergencyType" | "location" | "workActivity" | "rescueMethod" | "equipment", string>>;
  contacts?: Partial<Record<"siteSupervisor" | "siteSupervisorPhone" | "firstAider" | "firstAiderPhone" | "contractsManager1" | "contractsManager1Phone", string>>;
  risks?: { id: string; reason?: string }[];
  chemicals?: { id: string; reason?: string }[];
  unmatchedProducts?: string[];
  notes?: string;
};

const str = (description: string) => ({ type: "string", description });

const TOOL: Anthropic.Tool = {
  name: "draft_sssp",
  description: "Record the draft Site Specific Safety Plan for this job. Leave anything the sources don't support empty.",
  input_schema: {
    type: "object",
    properties: {
      jobNumber: str("Sansom job number, e.g. S34144. Empty if not stated."),
      projectName: str("Short project name in capitals, e.g. 'THE GALLERIES 23 GRAHAM ST WATERPROOFING REMEDIATION'. No job number."),
      siteAddress: str("Street address of the works."),
      mainContractor: str("Main contractor or client (e.g. body corporate) Sansom works for."),
      clientContactName: str("Client / main contractor contact (name and role)."),
      clientContactPhone: str("Their phone, only if stated."),
      projectManager: str("Sansom project / contracts manager."),
      projectManagerPhone: str("Sansom PM phone, only if stated."),
      startDate: str("Planned start date YYYY-MM-DD, only if stated."),
      endDate: str("Planned completion date YYYY-MM-DD, only if stated or derivable from a stated duration."),
      workTypes: { type: "array", items: { type: "string", enum: [...WORK_TYPES] }, description: "Every work type from the list that this job includes." },
      scope: str(
        "Scope of works as it would read in the SSSP: 2-5 sentences starting 'Sansom will…', covering each work area/activity, access method and key products, and stated exclusions."
      ),
      subcontractedWorks: str("Works Sansom subcontracts to others on this job (e.g. scaffolding by others, MEWP hire with operator). Empty if none."),
      answers: {
        type: "object",
        description: "The job-specific YES / N/A questions of the SSSP.",
        properties: Object.fromEntries(AI_QUESTIONS.map((q) => [q.id, { type: "string", enum: q.options, description: q.text }])),
      },
      controls: {
        type: "object",
        description: "If dust, noise or runoff is YES, how Sansom controls it on this site — one or two practical sentences each.",
        properties: { dust: str("Dust / fumes / smoke controls"), noise: str("Noise controls"), water: str("Wash-down / runoff / contaminant controls") },
      },
      notifiableWorks: {
        type: "array",
        items: { type: "string", enum: [...NOTIFIABLE_WORKS] },
        description: "Types of WorkSafe-notifiable particular hazardous work in Sansom's scope (e.g. Sansom erecting scaffold, work on a structure over 5 m from which a person could fall).",
      },
      notifiableOther: str("Any other notifiable work not in the list."),
      emergency: {
        type: "object",
        properties: {
          assemblyPoint: str("Assembly point if stated in the documents (e.g. main contractor's induction). Otherwise empty."),
          hospital: str("Nearest public hospital with an emergency department for the site address."),
          hospitalPhone: str("Its main phone number — only if you are certain; otherwise empty."),
          emergencyType: str("The most credible emergency needing a rescue plan for this work, e.g. 'Fall from height / suspended in harness', 'Person injured on MEWP platform', 'Chemical splash to eyes'."),
          location: str("Where on site that emergency could happen, e.g. 'Level 4 roof perimeter, north elevation'."),
          workActivity: str("The work activity involved, e.g. 'Torch-on membrane at roof edge'."),
          rescueMethod: str("Short rescue method, starting 'Only if it is safe, assess, stabilise, and prepare for rescue' then the job-specific method (e.g. MEWP ground controls to lower platform)."),
          equipment: str("Rescue / emergency equipment required, e.g. 'Rescue kit, first aid kit, eyewash station, fire extinguisher'."),
        },
      },
      contacts: {
        type: "object",
        description: "Sansom site contacts — ONLY if named in the documents. Never invent names or numbers.",
        properties: {
          siteSupervisor: str("Sansom site supervisor / foreman"),
          siteSupervisorPhone: str(""),
          firstAider: str("Sansom site first aider"),
          firstAiderPhone: str(""),
          contractsManager1: str("Sansom contracts manager"),
          contractsManager1Phone: str(""),
        },
      },
      risks: {
        type: "array",
        description: "Register risks that apply to Sansom's activities on THIS site (ids from the risk register list). Include the standard ones every site carries (e.g. adverse weather, slips/trips, manual handling, hazardous substances if products are used) plus those the scope triggers. Exclude risks for activities not in scope.",
        items: { type: "object", properties: { id: { type: "string" }, reason: str("Why it applies, under 12 words") }, required: ["id"] },
      },
      chemicals: {
        type: "array",
        description: "Chemical-register products (ids from the chemical register list) that will be brought on site — products named in the documents/TAs, including every component (Part A / Part B) and primers of a named system.",
        items: { type: "object", properties: { id: { type: "string" }, reason: str("Where it's used, under 10 words") }, required: ["id"] },
      },
      unmatchedProducts: { type: "array", items: { type: "string" }, description: "Products named in the sources that are NOT in the chemical register." },
      notes: str("What the project manager must check or add: assumptions made, conflicts between sources, and important details not found (assembly point, supervisor, first aider, dates)."),
    },
  },
};

async function riskCatalogue() {
  const risks = (await db.select().from(schema.risks)).filter((r) => r.status !== "Closed" && !r.id.startsWith("STR"));
  risks.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return {
    ids: new Set(risks.map((r) => r.id)),
    text: risks
      .map((r) => `[${r.id}] ${r.title} — ${r.description.length > 160 ? `${r.description.slice(0, 160)}…` : r.description}`)
      .join("\n"),
  };
}

async function linkedTaText(taIds: string[]) {
  const parts: string[] = [];
  for (const id of taIds) {
    const ta = await getTaFull(id);
    if (!ta) continue;
    parts.push(
      [
        `<task_analysis id="${ta.id}" status="${ta.status}">`,
        `Job: ${ta.jobNumber} ${ta.projectName}`,
        `Site: ${ta.siteAddress} · Main contractor: ${ta.mainContractor} · Site contact: ${ta.siteContactName} ${ta.siteContactPhone}`,
        `Sansom contract manager: ${ta.contractManager} ${ta.contractManagerPhone} · Date: ${ta.taDate ?? ""}`,
        `Work type: ${ta.workType}`,
        `Overview: ${ta.overview}`,
        `Permits: ${ta.permits.join("; ")}`,
        `Plant: ${ta.plant.map((p) => p.item).join("; ")}`,
        `Chemicals: ${ta.chemicals.map((c) => c.name).join("; ")}`,
        `PPE: ${ta.ppe.join(", ")}`,
        "Steps:",
        ...ta.steps.map((s, i) => `${i + 1}. ${s.description} — risks: ${s.identifiedRisks.join(", ")} [register: ${s.riskIds.join(", ")}]`),
        `</task_analysis>`,
      ].join("\n")
    );
  }
  return parts.join("\n\n");
}

export async function draftSssp(sssp: SsspHeader, opts: { instructions?: string } = {}): Promise<SsspDraft> {
  const [{ blocks, count }, tas, risks, chems] = await Promise.all([
    sourceBlocks(sssp.id),
    linkedTaText(sssp.data.taIds),
    riskCatalogue(),
    chemicalCatalogue(),
  ]);
  if (!count && !tas && !sssp.data.scope.trim()) {
    throw new Error("Give the AI something to work from — upload the proposal, link the job's TA, or write the scope first.");
  }

  const current = [
    `Already entered (keep consistent; fill gaps):`,
    `Job: ${sssp.jobNumber} ${sssp.projectName} · Site: ${sssp.siteAddress} · Client: ${sssp.mainContractor}`,
    `Scope: ${sssp.data.scope || "(none)"}`,
    `Work types: ${sssp.data.workTypes.join(", ") || "(none)"}`,
  ].join("\n");

  const response = await client().messages.create({
    model: model(),
    max_tokens: 8000,
    system: [
      {
        type: "text",
        text: `You prepare Site Specific Safety Plans (SSSPs) for Sansom Concrete Repairs Ltd, a New Zealand concrete repair, waterproofing and structural strengthening contractor. The SSSP follows Sansom's master template and the Health and Safety at Work Act 2015.

Ground every job fact (names, phones, addresses, dates, job numbers, assembly points) in the supplied documents or task analyses — never invent them; leave the field empty and mention it in notes. You may use general knowledge for the nearest hospital and for safety judgments (which risks apply, environmental controls, notifiable work, rescue plans).

Judgment guidance:
- "There will be hazardous products/substances brought onto site" is YES when any coatings, membranes, resins, sealants, primers, solvents, cementitious products or fuels are used; then "recorded on the register" and "SDS provided" are YES too.
- Notifiable works: YES if Sansom's own scope includes particular hazardous work (e.g. working where a person could fall 5 m or more, erecting scaffold, asbestos removal, lifting ≥500 kg). If only notifiable via others' scaffold, say N/A and note it. "WorkSafe has been notified" / "copy attached" follow the same answer only when notification is evidenced; otherwise answer N/A if not notifiable, and if notifiable but not evidenced answer N/A and say in notes it must be done.
- MEWP inspection is Daily when a MEWP / scissor / boom / vertical lifter is used; harness inspection is Daily when harnesses, rope access or fall arrest are used.
- Task analysis copies provided: YES when a task analysis is supplied.
- Environmental plan: YES only for sensitive sites or if the client requires one.

SANSOM RISK REGISTER (site and procedural risks):
${risks.text}

SANSOM CHEMICAL REGISTER (approved products):
${chems.text}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          ...blocks,
          ...(tas ? [{ type: "text" as const, text: `Task analyses for this job:\n${tas}` }] : []),
          {
            type: "text",
            text: `${current}${opts.instructions ? `\n\nThe project manager adds: ${opts.instructions}` : ""}\n\nDraft the SSSP with the draft_sssp tool.`,
          },
        ],
      },
    ],
  });

  const raw = forcedToolInput<SsspDraft>(response, TOOL.name);
  const iso = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const answers: Record<string, AnswerOption> = {};
  for (const q of AI_QUESTIONS) {
    const v = raw.answers?.[q.id];
    if (v && q.options.includes(v)) answers[q.id] = v;
  }
  const seenR = new Set<string>();
  const seenC = new Set<string>();
  return {
    ...raw,
    startDate: iso(raw.startDate),
    endDate: iso(raw.endDate),
    workTypes: (raw.workTypes || []).filter((w) => (WORK_TYPES as readonly string[]).includes(w)),
    notifiableWorks: (raw.notifiableWorks || []).filter((w) => (NOTIFIABLE_WORKS as readonly string[]).includes(w)),
    answers,
    risks: (raw.risks || []).filter((r) => r?.id && risks.ids.has(r.id) && !seenR.has(r.id) && seenR.add(r.id)),
    chemicals: (raw.chemicals || []).filter((c) => c?.id && chems.ids.has(c.id) && !seenC.has(c.id) && seenC.add(c.id)),
    unmatchedProducts: (raw.unmatchedProducts || []).map((s) => String(s).trim()).filter(Boolean),
  };
}
