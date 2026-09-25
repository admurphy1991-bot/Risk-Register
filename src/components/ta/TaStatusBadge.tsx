import { TA_STATUS_LABELS, type TaStatus } from "@/lib/ta-shared";

const STYLES: Record<TaStatus, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  submitted: "bg-amber-50 text-amber-800 border-amber-200",
  changes_requested: "bg-red-50 text-red-700 border-red-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-neutral-100 text-neutral-500 border-neutral-200",
};

export function TaStatusBadge({ status }: { status: TaStatus }) {
  return <span className={`text-xs px-1.5 py-0.5 rounded border ${STYLES[status]}`}>{TA_STATUS_LABELS[status]}</span>;
}
