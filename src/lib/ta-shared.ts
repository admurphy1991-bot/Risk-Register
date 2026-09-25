// Client-safe TA types, option lists, wording and validation (no database
// imports), shared by the API, the document generator and the builder UI.

export type PlantItem = { item: string; operatorRequirements: string };
export type ChemicalItem = { name: string; sds: string };
export type StepControl = { text: string; riskId: string | null };

export type TaStep = {
  id: string;
  description: string;
  identifiedRisks: string[];
  riskIds: string[];
  controls: StepControl[];
  initialLikelihood: number | null;
  initialConsequence: number | null;
  initialScore: number | null;
  residualLikelihood: number | null;
  residualConsequence: number | null;
  residualScore: number | null;
};

export type TaStatus = "draft" | "submitted" | "changes_requested" | "approved" | "closed";

export const TA_STATUS_LABELS: Record<TaStatus, string> = {
  draft: "Draft",
  submitted: "Awaiting H&S review",
  changes_requested: "Changes requested",
  approved: "Approved",
  closed: "Closed",
};

/** Statuses whose risks count as "live on site" for the cross-site rollup. */
export const ACTIVE_TA_STATUSES: TaStatus[] = ["submitted", "changes_requested", "approved"];

export const EDITABLE_TA_STATUSES: TaStatus[] = ["draft", "changes_requested"];

// PPE row from the template (the icon strip above the job-step table).
export const PPE_OPTIONS: { key: string; label: string }[] = [
  { key: "hard_hat", label: "Hard hat" },
  { key: "hi_vis", label: "Hi-vis" },
  { key: "safety_boots", label: "Safety boots" },
  { key: "eye_protection", label: "Safety glasses" },
  { key: "gloves", label: "Gloves" },
  { key: "face_shield", label: "Face shield" },
  { key: "dust_mask", label: "Dust mask (P2)" },
  { key: "respirator", label: "Respirator" },
  { key: "hearing", label: "Hearing protection" },
  { key: "harness", label: "Harness" },
  { key: "long_clothing", label: "Long sleeves / trousers" },
  { key: "coveralls", label: "Coveralls" },
];

export const PERMIT_OPTIONS = [
  "Permit To Work",
  "Authority To Work",
  "Work At Height Permit",
  "Hot Work Permit",
  "Confined Space Permit",
  "Isolation Permit",
  "Safe Dig Permit",
  "Restricted Item Work Permit",
  "Temporary Structure / Engineers Certificate",
  "Basic Lift Plan",
  "Complex Lift Plan",
  "Corridor Access Permit",
  "Resource Consent",
];

export const DEFAULT_LEGISLATION = [
  "Health and Safety at Work Act 2015",
  "Health and Safety at Work (General Risk and Workplace Management) Regulations 2016",
  "Sansom Construction Systems SSSP and company procedures",
  "Main contractor / building management site induction, access, permit and emergency procedures",
  "Manufacturer specifications and SDS for all products used",
];

export const DEFAULT_RESPONSIBLE_COMPLIANCE = "All Sansom workers and the Sansom Supervisor / Leading Hand";
export const DEFAULT_REVIEW_FREQUENCY =
  "Daily during works, following any change in weather, access, working area or method, and after any incident or near miss";

// Sansom's own wording from the TA/SWMS template.
export const CONSULTATION_TEXT = {
  heading: "RECORD OF CONSULTATION AND INDUCTION INTO SAFE WORK METHODS",
  acknowledgement:
    "By signing this record, I acknowledge I have been provided the opportunity to contribute to the identification of safety hazards associated with this work and to the formulation of work methods that will enable the work activity to be undertaken safely. I also acknowledge I have been instructed into the safe work methods and understand the requirements.",
  allWorkers:
    "All Workers are required to sign this register to indicate they have been trained in the processes and will work to the requirements of this Task Analysis/Safety Work Method Statement.",
  hierarchy:
    "In accordance with the ‘Health and Safety at Work Act 2015’, Hierarchy of Control measures is in accordance with the Act if it is not reasonably practicable to eliminate the risk.",
  additional: "Additional steps, photos and other supporting material may be added to further enhance this document as required.",
  completion: "Task Analysis Review and Approval - After Completion",
  completionSub: "This signifies completion of project and review on site by the client",
};

export type TaFileMeta = { id: string; filename: string; mimeType: string; sizeBytes: number; createdAt: string; hasText: boolean };
export type TaEvent = { id: string; taId: string; type: string; actorName: string; detail: string | null; createdAt: string };
export type TaDelivery = {
  id: string;
  event: string;
  taId: string | null;
  url: string;
  status: string;
  httpStatus: number | null;
  responseSnippet: string | null;
  error: string | null;
  createdAt: string;
};

/** Shape returned by GET /api/tas/[id] (and used by the document generator). */
export type TaFull = {
  id: string;
  jobNumber: string;
  projectName: string;
  taDate: string | null;
  siteAddress: string;
  mainContractor: string;
  siteContactName: string;
  siteContactPhone: string;
  contractManager: string;
  contractManagerPhone: string;
  workType: string;
  overview: string;
  permits: string[];
  legislation: string[];
  plant: PlantItem[];
  chemicals: ChemicalItem[];
  ppe: string[];
  responsibleCompliance: string;
  responsibleReview: string;
  reviewFrequency: string;
  status: TaStatus;
  preparedById: string | null;
  preparedByName: string;
  aiFilledFields: string[];
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewComment: string | null;
  createdAt: string;
  updatedAt: string;
  steps: TaStep[];
  files: TaFileMeta[];
  events: TaEvent[];
  deliveries: TaDelivery[];
};

/** Readiness checks shown before submission. */
export function validateForSubmission(ta: TaFull): string[] {
  const problems: string[] = [];
  if (!ta.jobNumber.trim()) problems.push("Job number is missing.");
  if (!ta.projectName.trim()) problems.push("Project name is missing.");
  if (!ta.siteAddress.trim()) problems.push("Site location is missing.");
  if (!ta.overview.trim()) problems.push("Overview of the work is missing.");
  if (ta.steps.length === 0) problems.push("Add at least one job step.");
  ta.steps.forEach((s, i) => {
    const n = i + 1;
    if (!s.description.trim()) problems.push(`Step ${n} has no description.`);
    if (s.identifiedRisks.length === 0) problems.push(`Step ${n} has no identified risks.`);
    if (s.controls.length === 0) problems.push(`Step ${n} has no control measures.`);
    if (s.initialScore === null) problems.push(`Step ${n} has no initial risk rating.`);
    if (s.residualScore === null) problems.push(`Step ${n} has no residual risk rating.`);
    if (s.initialScore !== null && s.residualScore !== null && s.residualScore > s.initialScore) {
      problems.push(`Step ${n}: residual rating is higher than the initial rating.`);
    }
  });
  return problems;
}
