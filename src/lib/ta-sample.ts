import type { TaFull } from "@/lib/ta";
import { computeScore } from "@/lib/risk-scoring";

// A realistic sample TA (based on the Galleries waterproofing job) used for
// the "Send test payload" button, so Make.com can learn the data structure
// before any real TA has been submitted.

function step(
  description: string,
  identifiedRisks: string[],
  riskIds: string[],
  controls: string[],
  [il, ic, rl, rc]: [number, number, number, number]
) {
  return {
    id: "sample",
    description,
    identifiedRisks,
    riskIds,
    controls: controls.map((text) => ({ text, riskId: riskIds[0] ?? null })),
    initialLikelihood: il,
    initialConsequence: ic,
    initialScore: computeScore(il, ic),
    residualLikelihood: rl,
    residualConsequence: rc,
    residualScore: computeScore(rl, rc),
  };
}

export function sampleTa(preparedByName: string): TaFull {
  const now = new Date().toISOString();
  return {
    id: "TA-SAMPLE",
    jobNumber: "S00000",
    projectName: "SAMPLE — THE GALLERIES WATERPROOFING REMEDIATION WORKS",
    taDate: now.slice(0, 10),
    siteAddress: "23 Graham Street, Auckland CBD",
    mainContractor: "Body Corporate (sample)",
    siteContactName: "Site Representative",
    siteContactPhone: "09 000 0000",
    contractManager: preparedByName,
    contractManagerPhone: "021 000 0000",
    workType: "Waterproofing remediation works (sample payload)",
    overview: "Sample TA sent from Settings so Make.com can learn the payload structure. Not a real job.",
    permits: ["Working at Height Permit", "Hot Work Permit"],
    legislation: ["Health and Safety at Work Act 2015"],
    plant: [{ item: "Vertical lifter / MEWP", operatorRequirements: "Competent operator only. Pre-start checks." }],
    chemicals: [{ name: "SikaRoof i-Cure 22 system", sds: "SDS available onsite" }],
    ppe: ["hard_hat", "hi_vis", "safety_boots", "gloves"],
    responsibleCompliance: "All Sansom workers and the Sansom Supervisor / Leading Hand",
    responsibleReview: `${preparedByName} / Supervisor / H&S Team`,
    reviewFrequency: "Daily during works",
    status: "submitted",
    preparedById: null,
    preparedByName,
    aiFilledFields: [],
    submittedAt: now,
    reviewedAt: null,
    reviewedByName: null,
    reviewComment: null,
    createdAt: now,
    updatedAt: now,
    steps: [
      step("Working at height - roof edge, harness and static line", ["Fall from height", "Falling tools/materials"], ["TAC-16"], ["Working at Height Permit and rescue plan in place before work starts", "Inspect harness gear and anchor points before use"], [3, 5, 1, 4]),
      step("Chemical handling and environmental protection", ["Skin/eye irritation", "Spills to drains"], ["TAC-23"], ["Read and follow current SDS for each product", "Keep containers closed when not in use"], [2, 3, 1, 3]),
    ],
    files: [],
    events: [],
    deliveries: [],
  };
}
