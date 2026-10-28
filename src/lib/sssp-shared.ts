// Client-safe SSSP (Site Specific Safety Plan) types, the question set from
// Sansom's master SSSP template, defaults and readiness checks.

import type { TaStatus } from "@/lib/ta-shared";

export type SsspStatus = TaStatus;

// Work types — the checkbox grid on the Project Information page.
export const WORK_TYPES = [
  "Baffle joints",
  "Carbon fibre reinforcing",
  "Coating",
  "Concrete repairs",
  "Crack injection",
  "Fibre glass reinforcing",
  "Floor repairs",
  "Guidance cabling",
  "Grouting",
  "Helifix",
  "Joint sealant",
  "Seismic jointing system",
  "Tanking – under slab",
  "Tanking - Walls",
  "Torch on membrane",
  "Warm Roof",
] as const;

// Notification of particular hazardous construction work (WorkSafe).
export const NOTIFIABLE_WORKS = [
  "Scaffolding (all kinds)",
  "Buildings and structures over 5 meters",
  "Use of a lifting appliance to lift 500 kg or more, or a vertical distance of 5 metres or more",
  "Any narrow pit, shaft, trench, or excavation more than 1.5 metres deep",
  "Drive, excavation, or heading with ground cover overhead",
  "Excavated face over 5 metres deep with a face steeper than 63.4°",
  "Use of explosives",
  "Work in or breathing compressed air or an air substitute",
  "Restricted work involving asbestos",
  "Demolition",
  "Tree felling, logging, arboriculture",
  "Tree felling in the maintenance of overhead power lines",
] as const;

export type AnswerOption = "yes" | "na" | "before" | "weekly" | "daily";

export const OPTION_LABELS: Record<AnswerOption, string> = {
  yes: "Yes",
  na: "N/A",
  before: "Before starting",
  weekly: "Weekly",
  daily: "Daily",
};

export type SsspQuestion = {
  id: string;
  group: string;
  text: string;
  options: AnswerOption[];
  default: AnswerOption | null; // null = must be decided for this job
  /** Whether the AI decides this one from the job (otherwise it's a Sansom standard). */
  ai?: boolean;
};

export const QUESTION_GROUPS = [
  { id: "standards", title: "Standards & frequency" },
  { id: "rules", title: "Site rules" },
  { id: "general", title: "General information" },
  { id: "communications", title: "Communications" },
  { id: "inspections", title: "Inspections" },
  { id: "staff", title: "Staff" },
  { id: "environment", title: "Environmental" },
] as const;

const YN: AnswerOption[] = ["yes", "na"];

// Text is the template's own wording (used to find the row in the Word doc).
export const QUESTIONS: SsspQuestion[] = [
  { id: "daily_prestart", group: "standards", text: "Donesafe - HSEQ - Daily Pre-Start Assessment - completed daily", options: YN, default: "yes" },
  { id: "weekly_toolbox", group: "standards", text: "Donesafe - HSEQ - Weekly Toolbox Meeting - held weekly, on site and all persons on site to attend", options: YN, default: "yes" },
  { id: "weekly_inspection", group: "standards", text: "Donesafe - HSEQ - Weekly Site Safety Inspection - completed weekly", options: YN, default: "yes" },
  { id: "qa", group: "standards", text: "Quality assurance is completed when required", options: YN, default: "yes" },
  { id: "sign_in", group: "standards", text: "Everyone coming onto the site is to sign in and sign out", options: YN, default: "yes" },

  { id: "ppe", group: "rules", text: "Personal Protective Equipment (PPE) to be used by everyone, with no exceptions", options: YN, default: "yes" },
  { id: "parking", group: "rules", text: "Parking: In the designated locations informed to you during the site induction", options: YN, default: "yes" },
  { id: "smoking", group: "rules", text: "Smoking / Vaping: Only permitted in approved or designated areas", options: YN, default: "yes" },
  { id: "behaviour", group: "rules", text: "Behaviour: all communication (language) is to be respectful, no swearing", options: YN, default: "yes" },
  { id: "hygiene", group: "rules", text: "Hygiene: good hygiene practices", options: YN, default: "yes" },
  { id: "first_aid", group: "rules", text: "First Aid Supplies: Sansom vehicles carry a First Aid kit; supervisor / first aider provides supplies", options: YN, default: "yes" },

  { id: "subcontractors", group: "general", text: "Subcontractors to PCBU 2 working on the site not covered by this agreement will supply their own SSSP", options: YN, default: null, ai: true },
  { id: "notifiable", group: "general", text: "There will be notifiable works that need to be reported to WorkSafe", options: YN, default: null, ai: true },
  { id: "worksafe_notified", group: "general", text: "WorkSafe has been notified of these works", options: YN, default: null, ai: true },
  { id: "notification_attached", group: "general", text: "A copy of the notification (or receipt from WorkSafe) is attached", options: YN, default: null, ai: true },
  { id: "ta_required", group: "general", text: "Task Analyses are required for some on-site activities", options: YN, default: "yes" },
  { id: "ta_copies", group: "general", text: "Copies of these have been provided with this SSSP", options: YN, default: null, ai: true },
  { id: "erp_provided", group: "general", text: "Emergency Response Plans have also been provided", options: YN, default: "yes" },
  { id: "hazardous_products", group: "general", text: "There will be hazardous products/substances brought onto to site", options: YN, default: null, ai: true },
  { id: "hazardous_recorded", group: "general", text: "These products are recorded on the hazardous substances register", options: YN, default: null, ai: true },
  { id: "sds_provided", group: "general", text: "The relevant material safety data sheets have been provided", options: YN, default: null, ai: true },
  { id: "hazard_register", group: "general", text: "A hazard register for our activities on this site has been provided", options: YN, default: "yes" },

  { id: "comm_toolbox", group: "communications", text: "Toolbox talks — weekly through the Donesafe HSEQ Reporting Platform", options: YN, default: "yes" },
  { id: "comm_project_prestart", group: "communications", text: "Project pre-start briefings — daily project requirements", options: YN, default: "yes" },
  { id: "comm_daily_prestart", group: "communications", text: "Daily pre-start briefings — daily per Donesafe HSEQ Reporting Platform", options: YN, default: "yes" },
  { id: "comm_progress", group: "communications", text: "Progress meetings — regularly", options: YN, default: "yes" },
  { id: "comm_pack_down", group: "communications", text: "Pack down check list — if called for", options: YN, default: "na" },

  { id: "insp_prestart", group: "inspections", text: "Pre-start site inspection", options: ["before", "na"], default: "before" },
  { id: "insp_site", group: "inspections", text: "Site inspection (weekly through Donesafe)", options: ["weekly", "na"], default: "weekly" },
  { id: "insp_mewp", group: "inspections", text: "MEWP", options: ["daily", "na"], default: null, ai: true },
  { id: "insp_harness", group: "inspections", text: "Harness, ropes, rigging equipment, etc", options: ["daily", "na"], default: null, ai: true },

  { id: "staff_card", group: "staff", text: "Every worker under our control on site will have a current site safety card or booking confirmation", options: YN, default: "yes" },
  { id: "staff_inducted", group: "staff", text: "Every worker under our control on site will be inducted on site", options: YN, default: "yes" },
  { id: "staff_competent", group: "staff", text: "Every worker under our control will be suitably qualified, competent, or supervised", options: YN, default: "yes" },
  { id: "staff_register", group: "staff", text: "Our competency register is attached", options: YN, default: "yes" },

  { id: "env_plan", group: "environment", text: "Is there an environmental plan required for this site?", options: YN, default: null, ai: true },
  { id: "env_dust", group: "environment", text: "Will dust, fumes, or smoke be generated that could affect members of the public/others?", options: YN, default: null, ai: true },
  { id: "env_noise", group: "environment", text: "Will noise be generated that could affect members of the public or others?", options: YN, default: null, ai: true },
  { id: "env_water", group: "environment", text: "Could your activity potentially cause dirty water or wash-down runoff, silt or other contaminants to be released?", options: YN, default: null, ai: true },
];

export const QUESTION_IDS = QUESTIONS.map((q) => q.id);

export type SsspContacts = {
  director: string;
  directorPhone: string;
  contractsManager1: string;
  contractsManager1Phone: string;
  contractsManager2: string;
  contractsManager2Phone: string;
  siteSupervisor: string;
  siteSupervisorPhone: string;
  firstAider: string;
  firstAiderPhone: string;
};

export type SsspEmergency = {
  assemblyPoint: string;
  hospital: string;
  hospitalPhone: string;
  emergencyType: string;
  location: string;
  workActivity: string;
  rescueMethod: string;
  equipment: string;
};

export type SsspData = {
  ssspDate: string | null;
  startDate: string | null;
  endDate: string | null;
  clientContactName: string;
  clientContactPhone: string;
  projectManager: string;
  projectManagerPhone: string;
  workTypes: string[];
  scope: string;
  subcontractedWorks: string;
  answers: Record<string, AnswerOption | null>;
  controls: { dust: string; noise: string; water: string };
  notifiableWorks: string[];
  notifiableOther: string;
  emergency: SsspEmergency;
  contacts: SsspContacts;
  riskIds: string[];
  riskReasons: Record<string, string>;
  chemicalIds: string[];
  chemicalReasons: Record<string, string>;
  /** Products named in the documents that aren't in the chemical register. */
  unmatchedProducts: string[];
  taIds: string[];
  aiNotes: string;
};

export const HEADER_FIELDS = ["jobNumber", "projectName", "siteAddress", "mainContractor"] as const;
export type SsspHeaderField = (typeof HEADER_FIELDS)[number];

export const DEFAULT_ERP_RESCUE = "Only if it is safe, Assess, stabilise, and prepare for rescue";

export function defaultSsspData(): SsspData {
  const answers: Record<string, AnswerOption | null> = {};
  for (const q of QUESTIONS) answers[q.id] = q.default;
  return {
    ssspDate: null,
    startDate: null,
    endDate: null,
    clientContactName: "",
    clientContactPhone: "",
    projectManager: "",
    projectManagerPhone: "",
    workTypes: [],
    scope: "",
    subcontractedWorks: "",
    answers,
    controls: { dust: "Vacuums are used for all dust created", noise: "", water: "" },
    notifiableWorks: [],
    notifiableOther: "",
    emergency: {
      assemblyPoint: "",
      hospital: "Auckland City Hospital (Grafton)",
      hospitalPhone: "09 367 0000",
      emergencyType: "",
      location: "",
      workActivity: "",
      rescueMethod: DEFAULT_ERP_RESCUE,
      equipment: "",
    },
    contacts: {
      director: "",
      directorPhone: "",
      contractsManager1: "",
      contractsManager1Phone: "",
      contractsManager2: "",
      contractsManager2Phone: "",
      siteSupervisor: "",
      siteSupervisorPhone: "",
      firstAider: "",
      firstAiderPhone: "",
    },
    riskIds: [],
    riskReasons: {},
    chemicalIds: [],
    chemicalReasons: {},
    unmatchedProducts: [],
    taIds: [],
    aiNotes: "",
  };
}

/** Fills any keys missing from stored data (older rows, partial JSON). */
export function normaliseSsspData(raw: unknown): SsspData {
  const d = defaultSsspData();
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<SsspData>;
  return {
    ...d,
    ...r,
    answers: { ...d.answers, ...(r.answers || {}) },
    controls: { ...d.controls, ...(r.controls || {}) },
    emergency: { ...d.emergency, ...(r.emergency || {}) },
    contacts: { ...d.contacts, ...(r.contacts || {}) },
    riskReasons: r.riskReasons || {},
    chemicalReasons: r.chemicalReasons || {},
  };
}

export type SsspFileMeta = { id: string; filename: string; mimeType: string; sizeBytes: number; createdAt: string; hasText: boolean };
export type SsspEvent = { id: string; taId: string; type: string; actorName: string; detail: string | null; createdAt: string };

export type SsspFull = {
  id: string;
  jobNumber: string;
  projectName: string;
  siteAddress: string;
  mainContractor: string;
  data: SsspData;
  status: SsspStatus;
  preparedById: string | null;
  preparedByName: string;
  aiFilledFields: string[];
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewComment: string | null;
  createdAt: string;
  updatedAt: string;
  files: SsspFileMeta[];
  events: SsspEvent[];
};

export type SsspPatch = Partial<Record<SsspHeaderField, string>> & { data?: Partial<SsspData> };

/** Blocking problems before submission. */
export function ssspProblems(s: SsspFull): string[] {
  const p: string[] = [];
  const d = s.data;
  if (!s.jobNumber.trim()) p.push("Job number is missing.");
  if (!s.projectName.trim()) p.push("Project name is missing.");
  if (!s.siteAddress.trim()) p.push("Project / site location is missing.");
  if (!s.mainContractor.trim()) p.push("Main contractor / client is missing.");
  if (!d.projectManager.trim()) p.push("Sansom project manager is missing.");
  if (!d.workTypes.length) p.push("Tick at least one work type.");
  if (!d.riskIds.length) p.push("Select the site risks for this job (risk register section).");
  const unanswered = QUESTIONS.filter((q) => !d.answers[q.id]);
  if (unanswered.length) p.push(`${unanswered.length} YES / N/A question${unanswered.length === 1 ? " is" : "s are"} unanswered (Site & safety tab).`);
  if (d.answers.hazardous_products === "yes" && !d.chemicalIds.length) p.push("Hazardous products are coming on site but none are listed in the hazardous substance register.");
  for (const [k, label] of [["env_dust", "dust"], ["env_noise", "noise"], ["env_water", "runoff"]] as const) {
    const key = k.replace("env_", "") as "dust" | "noise" | "water";
    if (d.answers[k] === "yes" && !d.controls[key].trim()) p.push(`Explain how ${label} will be controlled.`);
  }
  if (d.answers.notifiable === "yes" && !d.notifiableWorks.length && !d.notifiableOther.trim()) p.push("Notifiable works is YES — tick the type of notifiable work.");
  if (!d.emergency.assemblyPoint.trim()) p.push("Emergency assembly point is missing.");
  if (!d.contacts.siteSupervisor.trim()) p.push("Site supervisor (emergency contacts) is missing.");
  if (!d.contacts.firstAider.trim()) p.push("Site first aider (emergency contacts) is missing.");
  return p;
}

export const SSSP_EVENT_LABELS: Record<string, string> = {
  created: "Created",
  files_added: "Documents added",
  ai_built: "AI drafted the SSSP",
  tas_linked: "Task analyses linked",
  submitted: "Submitted for H&S review",
  resubmitted: "Resubmitted for H&S review",
  approved: "Approved by H&S",
  changes_requested: "Changes requested by H&S",
  closed: "Closed (job complete)",
  handoff_sent: "Sent to Make.com",
  handoff_failed: "Make.com handoff failed",
  handoff_skipped: "Make.com not configured — not sent",
};
