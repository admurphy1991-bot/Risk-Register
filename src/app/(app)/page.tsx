import { getDashboardStats } from "@/lib/dashboard";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";
import Link from "next/link";
import { scoreLevel, LEVEL_COLORS } from "@/lib/risk-scoring";

export const dynamic = "force-dynamic";

function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      {sub && <p className="text-xs text-neutral-400 mt-1">{sub}</p>}
    </div>
  );
}

function AppetiteBar({ label, value, max, breach }: { label: string; value: number; max: number; breach: boolean }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-neutral-700">{label}</span>
        <span className={`font-medium ${breach ? "text-red-600" : "text-emerald-600"}`}>{value}</span>
      </div>
      <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
        <div className={`h-full rounded-full ${breach ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const stats = await getDashboardStats();
  const recentPlans = await db.select().from(schema.changePlans).orderBy(desc(schema.changePlans.createdAt)).limit(8);
  const upcoming = (await db.select().from(schema.risks)).filter((r) => r.nextReviewDate).sort((a, b) => (a.nextReviewDate! < b.nextReviewDate! ? -1 : 1)).slice(0, 6);

  const categoryEntries = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);
  const locationEntries = Object.entries(stats.byLocation).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Board report</h1>
          <p className="text-sm text-neutral-500">
            {new Date().toLocaleDateString("en-AU", { month: "long", year: "numeric" })}
          </p>
        </div>
        <Link href="/register" className="text-sm text-accent font-medium hover:underline">
          Open risk register →
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Total risks" value={stats.total} sub={`${stats.open} open`} />
        <StatTile label="High / extreme" value={stats.highExtreme} sub="by residual score" />
        <StatTile label="Reviews overdue" value={stats.overdueReview} sub={`${stats.reviewDueSoon} due in 30 days`} />
        <StatTile label="Register coverage" value={`${stats.registerCoverage}%`} sub="risks with a score" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-medium text-neutral-700">Appetite</h2>
          <AppetiteBar label="Reviews overdue" value={stats.overdueReview} max={Math.max(5, stats.total)} breach={stats.overdueReview > 0} />
          <AppetiteBar label="Register coverage" value={stats.registerCoverage} max={100} breach={stats.registerCoverage < 90} />
          <AppetiteBar
            label="High / extreme residual risks"
            value={stats.highExtreme}
            max={Math.max(5, stats.total)}
            breach={stats.highExtreme > Math.max(2, Math.round(stats.total * 0.2))}
          />
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-medium text-neutral-700 mb-3">By category</h2>
          <div className="space-y-2">
            {categoryEntries.map(([name, count]) => (
              <div key={name} className="flex items-center gap-3 text-sm">
                <span className="w-40 truncate text-neutral-600">{name}</span>
                <div className="flex-1 h-2 rounded-full bg-neutral-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.round((count / stats.total) * 100)}%` }}
                  />
                </div>
                <span className="text-neutral-500 w-6 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-medium text-neutral-700 mb-3">Review due soonest</h2>
          <ul className="divide-y divide-border">
            {upcoming.map((r) => {
              const level = scoreLevel(r.residualScore ?? r.inherentScore ?? null);
              return (
                <li key={r.id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <span className="mono-id text-neutral-400 mr-2">{r.id}</span>
                    <span className="text-neutral-800">{r.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {level && (
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border ${LEVEL_COLORS[level]}`}>{level}</span>
                    )}
                    <span className="text-neutral-500">{r.nextReviewDate}</span>
                  </div>
                </li>
              );
            })}
            {upcoming.length === 0 && <p className="text-sm text-neutral-400 py-2">Nothing scheduled.</p>}
          </ul>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-medium text-neutral-700 mb-3">Recent activity</h2>
          <ul className="divide-y divide-border">
            {recentPlans.map((p) => (
              <li key={p.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-800">{p.summary}</span>
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded border ${
                      p.status === "applied"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : p.status === "undone"
                        ? "bg-neutral-100 text-neutral-500 border-neutral-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {p.actorName} · {p.actorType} · {new Date(p.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
            {recentPlans.length === 0 && <p className="text-sm text-neutral-400 py-2">No activity yet.</p>}
          </ul>
        </div>
      </div>

      <p className="text-xs text-neutral-400">Locations tracked: {locationEntries.map(([n]) => n).join(", ") || "—"}</p>
    </div>
  );
}
