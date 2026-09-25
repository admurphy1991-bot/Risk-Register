import { db, schema } from "@/lib/db";
import { isHighOrCritical } from "@/lib/risk-scoring";

export async function getDashboardStats() {
  const risks = await db.select().from(schema.risks);
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const total = risks.length;
  const open = risks.filter((r) => r.status !== "Closed").length;
  const highCritical = risks.filter((r) => isHighOrCritical(r.residualScore ?? r.inherentScore ?? null)).length;
  const overdueReview = risks.filter((r) => r.nextReviewDate && new Date(r.nextReviewDate) < now).length;
  const reviewDueSoon = risks.filter(
    (r) => r.nextReviewDate && new Date(r.nextReviewDate) >= now && new Date(r.nextReviewDate) <= in30
  ).length;
  const draftOrMissingScore = risks.filter((r) => r.inherentScore === null && r.residualScore === null).length;

  const byCategory: Record<string, number> = {};
  const byLocation: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const r of risks) {
    if (r.category) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    if (r.location) byLocation[r.location] = (byLocation[r.location] || 0) + 1;
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }

  const registerCoverage = total ? Math.round(((total - draftOrMissingScore) / total) * 100) : 0;

  return { total, open, highCritical, overdueReview, reviewDueSoon, registerCoverage, byCategory, byLocation, byStatus };
}
