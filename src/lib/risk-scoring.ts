// Shared 5x5 likelihood/consequence risk-scoring helpers, used by the UI,
// the API, and the AI tool layer so every surface agrees on the same bands.

export const LIKELIHOOD_LABELS = [
  "Rare",
  "Unlikely",
  "Possible",
  "Likely",
  "Almost certain",
];

export const CONSEQUENCE_LABELS = [
  "Insignificant",
  "Minor",
  "Moderate",
  "Major",
  "Catastrophic",
];

export type RiskLevel = "Low" | "Medium" | "High" | "Extreme";

export function computeScore(
  likelihood?: number | null,
  consequence?: number | null
): number | null {
  if (!likelihood || !consequence) return null;
  return likelihood * consequence;
}

export function scoreLevel(score: number | null): RiskLevel | null {
  if (score === null || score === undefined) return null;
  if (score >= 15) return "Extreme";
  if (score >= 10) return "High";
  if (score >= 5) return "Medium";
  return "Low";
}

export const LEVEL_COLORS: Record<RiskLevel, string> = {
  Low: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Medium: "bg-amber-100 text-amber-800 border-amber-200",
  High: "bg-orange-100 text-orange-800 border-orange-200",
  Extreme: "bg-red-100 text-red-800 border-red-200",
};

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
