"use client";

import { CONSEQUENCE_LABELS, LIKELIHOOD_LABELS, LEVEL_COLORS, computeScore, ratingLabel, scoreLevel } from "@/lib/risk-scoring";

export function RatingBadge({ score, className = "" }: { score: number | null | undefined; className?: string }) {
  const level = scoreLevel(score);
  if (!level) return <span className={`text-xs text-neutral-400 ${className}`}>Not rated</span>;
  return <span className={`text-xs px-1.5 py-0.5 rounded border font-semibold whitespace-nowrap ${LEVEL_COLORS[level]} ${className}`}>{ratingLabel(score)}</span>;
}

export function RatingPicker({
  label,
  likelihood,
  consequence,
  onChange,
  disabled,
}: {
  label: string;
  likelihood: number | null;
  consequence: number | null;
  onChange: (l: number | null, c: number | null) => void;
  disabled?: boolean;
}) {
  const score = computeScore(likelihood, consequence);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">{label}</span>
        <RatingBadge score={score} />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          aria-label={`${label} likelihood`}
          disabled={disabled}
          value={likelihood ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null, consequence)}
          className="w-full rounded-md border border-border px-1.5 py-1 text-xs bg-white"
        >
          <option value="">Likelihood…</option>
          {LIKELIHOOD_LABELS.map((l, i) => (
            <option key={l} value={i + 1}>
              {i + 1} {l}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} consequence`}
          disabled={disabled}
          value={consequence ?? ""}
          onChange={(e) => onChange(likelihood, e.target.value ? Number(e.target.value) : null)}
          className="w-full rounded-md border border-border px-1.5 py-1 text-xs bg-white"
        >
          <option value="">Consequence…</option>
          {CONSEQUENCE_LABELS.map((l, i) => (
            <option key={l} value={i + 1}>
              {i + 1} {l}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
