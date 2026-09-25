// Shared 5x5 likelihood/consequence risk-scoring helpers, used by the UI,
// the API, the AI tool layer, and the TA document generator so every surface
// agrees on the same bands.
//
// These follow Sansom's own matrix (the "Risk Matrix" and "Risk Calculation"
// sheets of the Sansom Risk Register workbook): score = likelihood x
// consequence, banded Low 1-3, Moderate 4-6, High 8-12, Critical 15-25.
// (7, 11, 13 and 14 can't occur as products on a 5x5 grid.)

export const LIKELIHOOD_LABELS = [
  "Rare",
  "Unlikely",
  "Possible",
  "Likely",
  "Almost Certain",
];

export const LIKELIHOOD_DESCRIPTIONS = [
  "Practically impossible — greater than a 10-year event",
  "Not likely to occur — typically every 1-10 years",
  "Could occur at the site — typically each year",
  "Known to have occurred — typically 1-10 times a year",
  "A common result — more than 10 times a year",
];

export const CONSEQUENCE_LABELS = [
  "Minor",
  "Medium",
  "Serious",
  "Major",
  "Catastrophic",
];

export const CONSEQUENCE_DESCRIPTIONS = [
  "First aid, no medical treatment or impairment. Minimal financial loss",
  "Medical treatment, ~2-week temporary impairment. Recordable. Loss <$15k",
  "Temporary impairment <6 months. Notifiable event. Loss $15k-$30k",
  "Fatality, or injury not recovered within 6 months. Loss $30k-$100k",
  "Multiple fatalities. High consequence event. Loss >$100k",
];

export type RiskLevel = "Low" | "Moderate" | "High" | "Critical";

export const RISK_LEVELS: RiskLevel[] = ["Low", "Moderate", "High", "Critical"];

export function computeScore(
  likelihood?: number | null,
  consequence?: number | null
): number | null {
  if (!likelihood || !consequence) return null;
  return likelihood * consequence;
}

export function scoreLevel(score: number | null | undefined): RiskLevel | null {
  if (score === null || score === undefined) return null;
  if (score >= 15) return "Critical";
  if (score >= 7) return "High";
  if (score >= 4) return "Moderate";
  return "Low";
}

/** e.g. "HIGH 12" — the format used in the rating columns of a Sansom TA. */
export function ratingLabel(score: number | null | undefined): string {
  const level = scoreLevel(score);
  return level ? `${level.toUpperCase()} ${score}` : "—";
}

export const LEVEL_COLORS: Record<RiskLevel, string> = {
  Low: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Moderate: "bg-yellow-100 text-yellow-800 border-yellow-300",
  High: "bg-orange-100 text-orange-800 border-orange-200",
  Critical: "bg-red-100 text-red-800 border-red-200",
};

/** Solid heat-map fills used in generated documents (hex, no #). */
export const LEVEL_HEX: Record<RiskLevel, { fill: string; text: string }> = {
  Low: { fill: "00B050", text: "FFFFFF" },
  Moderate: { fill: "FFFF00", text: "000000" },
  High: { fill: "FFC000", text: "000000" },
  Critical: { fill: "FF0000", text: "FFFFFF" },
};

export function isHighOrCritical(score: number | null | undefined): boolean {
  const level = scoreLevel(score);
  return level === "High" || level === "Critical";
}

export const STATUS_OPTIONS = [
  "Draft",
  "Active",
  "Under treatment",
  "Monitored",
  "Closed",
] as const;

export const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600 border-slate-200",
  Active: "bg-red-50 text-red-700 border-red-200",
  "Under treatment": "bg-indigo-50 text-indigo-700 border-indigo-200",
  Monitored: "bg-blue-50 text-blue-700 border-blue-200",
  Closed: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export const CATEGORY_COLORS: Record<string, string> = {
  "Plant and equipment": "bg-slate-100 text-slate-700 border-slate-200",
  Psychosocial: "bg-sky-100 text-sky-700 border-sky-200",
  "Working at height": "bg-amber-100 text-amber-800 border-amber-200",
  "Manual handling": "bg-rose-100 text-rose-700 border-rose-200",
  "Hazardous substances": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "Contractor management": "bg-teal-100 text-teal-700 border-teal-200",
};

export function categoryColor(category: string): string {
  return (
    CATEGORY_COLORS[category] ??
    "bg-violet-100 text-violet-700 border-violet-200"
  );
}
