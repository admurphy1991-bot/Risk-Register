"use client";

import { useState } from "react";
import { validateForSubmission, TA_STATUS_LABELS, PPE_OPTIONS, EDITABLE_TA_STATUSES, type TaFull } from "@/lib/ta-shared";
import { canReviewRole } from "@/lib/roles";
import { RatingBadge } from "@/components/ta/RatingPicker";

type Delivery = { status: "sent" | "failed" | "skipped"; message: string };

const EVENT_LABELS: Record<string, string> = {
  created: "Created",
  files_added: "Documents added",
  ai_extracted: "AI read the documents",
  ai_suggested_steps: "AI drafted steps",
  submitted: "Submitted for H&S review",
  resubmitted: "Resubmitted for H&S review",
  approved: "Approved by H&S",
  changes_requested: "Changes requested by H&S",
  closed: "Closed (job complete)",
  handoff_sent: "Sent to Make.com",
  handoff_failed: "Make.com handoff failed",
  handoff_skipped: "Make.com not configured — not sent",
};

export function ReviewPanel({
  ta,
  user,
  webhookConfigured,
  flush,
  onUpdated,
  registerTitles,
}: {
  ta: TaFull;
  user: { id: string; role: string };
  webhookConfigured: boolean;
  flush: () => Promise<boolean>;
  onUpdated: (ta: TaFull) => void;
  registerTitles: Map<string, string>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [comment, setComment] = useState("");

  const editable = EDITABLE_TA_STATUSES.includes(ta.status);
  const liveProblems = validateForSubmission(ta);
  const isReviewer = canReviewRole(user.role) && (user.role === "admin" || user.id !== ta.preparedById);

  async function call(action: string, url: string, body?: unknown) {
    setBusy(action);
    setError(null);
    setProblems(null);
    setDelivery(null);
    try {
      if (!(await flush())) throw new Error("Couldn't save your latest changes — check your connection and try again.");
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.problems) setProblems(data.problems);
        throw new Error(data.error || "Something went wrong");
      }
      if (data.ta) onUpdated(data.ta);
      if (data.delivery) setDelivery(data.delivery);
      setComment("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const ppeLabels = PPE_OPTIONS.filter((p) => ta.ppe.includes(p.key)).map((p) => p.label);

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
      <div className="space-y-5 min-w-0">
        {/* Status banner */}
        <StatusBanner ta={ta} />

        {/* Submit (PM) */}
        {editable && (
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-medium mb-2">Ready to submit?</p>
            {liveProblems.length ? (
              <ul className="text-sm text-amber-800 space-y-0.5 mb-3">
                {liveProblems.map((p) => (
                  <li key={p}>• {p}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-emerald-700 mb-3">✓ Everything required is filled in.</p>
            )}
            {!webhookConfigured && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mb-3">
                The Make.com webhook isn&apos;t set up yet (Settings → TA workflow), so submitting will lock the TA for review but
                won&apos;t email M-Files or the H&amp;S manager.
              </p>
            )}
            <button
              onClick={() => call("submit", `/api/tas/${ta.id}/submit`)}
              disabled={!!busy || liveProblems.length > 0}
              className="rounded-lg bg-accent text-white text-sm font-medium px-4 py-2 hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy === "submit" ? "Submitting…" : ta.status === "changes_requested" ? "Resubmit for H&S review" : "Submit for H&S review"}
            </button>
            <p className="text-xs text-neutral-500 mt-2">
              Submitting locks the TA, files the Word document to M-Files and emails the H&amp;S manager for review (via Make.com).
            </p>
          </div>
        )}

        {/* Review (H&S) */}
        {ta.status === "submitted" && (
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-medium mb-2">H&amp;S review</p>
            {isReviewer ? (
              <>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  placeholder="Comment — required when requesting changes (e.g. “Step 5: add rescue plan details”)"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => call("approve", `/api/tas/${ta.id}/review`, { decision: "approve", comment })}
                    disabled={!!busy}
                    className="rounded-lg bg-emerald-600 text-white text-sm font-medium px-4 py-2 hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busy === "approve" ? "Approving…" : "Approve TA"}
                  </button>
                  <button
                    onClick={() => call("changes", `/api/tas/${ta.id}/review`, { decision: "changes", comment })}
                    disabled={!!busy || !comment.trim()}
                    className="rounded-lg border border-red-300 text-red-700 text-sm font-medium px-4 py-2 hover:bg-red-50 disabled:opacity-50"
                  >
                    {busy === "changes" ? "Sending…" : "Request changes"}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-neutral-500">
                Waiting for an H&amp;S reviewer.{" "}
                {user.id === ta.preparedById ? "You prepared this TA, so someone else needs to review it." : "Only H&S reviewers or admins can approve."}
              </p>
            )}
          </div>
        )}

        {ta.status === "approved" && (canReviewRole(user.role) || user.id === ta.preparedById) && (
          <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-neutral-600">Job finished? Closing the TA removes its risks from the live site rollup.</p>
            <button
              onClick={() => call("close", `/api/tas/${ta.id}/review`, { decision: "close" })}
              disabled={!!busy}
              className="rounded-lg border border-border text-sm px-4 py-2 hover:bg-neutral-50 disabled:opacity-50"
            >
              {busy === "close" ? "Closing…" : "Close TA"}
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
            {problems && (
              <ul className="mt-1">
                {problems.map((p) => (
                  <li key={p}>• {p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {delivery && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              delivery.status === "sent" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {delivery.message}
          </div>
        )}

        {/* Read-only preview */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <p className="text-sm font-medium">Preview</p>
            <a href={`/api/tas/${ta.id}/document`} className="text-xs text-accent font-medium hover:underline">
              Download Word document ↓
            </a>
          </div>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-sm border-b border-border">
            <Detail label="Project" value={[ta.jobNumber, ta.projectName].filter(Boolean).join(" - ")} />
            <Detail label="Date" value={ta.taDate ?? ""} />
            <Detail label="Location" value={ta.siteAddress} />
            <Detail label="Main contractor" value={ta.mainContractor} />
            <Detail label="Site contact" value={[ta.siteContactName, ta.siteContactPhone].filter(Boolean).join(" · ")} />
            <Detail label="Sansom contract manager" value={[ta.contractManager, ta.contractManagerPhone].filter(Boolean).join(" · ")} />
            <Detail label="Permits" value={ta.permits.join("; ")} />
            <Detail label="PPE" value={ppeLabels.join(", ")} />
            <div className="sm:col-span-2">
              <Detail label="Overview of the work" value={ta.overview} />
            </div>
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="bg-neutral-50 text-left text-neutral-500">
                  <th className="px-3 py-2 font-medium w-8">#</th>
                  <th className="px-3 py-2 font-medium">Job step</th>
                  <th className="px-3 py-2 font-medium">Identified risks</th>
                  <th className="px-3 py-2 font-medium text-center">Initial</th>
                  <th className="px-3 py-2 font-medium">Control measures</th>
                  <th className="px-3 py-2 font-medium text-center">Residual</th>
                </tr>
              </thead>
              <tbody>
                {ta.steps.map((s, i) => (
                  <tr key={s.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 text-neutral-400">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-neutral-800">{s.description}</td>
                    <td className="px-3 py-2 text-neutral-700">
                      {s.identifiedRisks.map((r) => (
                        <div key={r}>{r}</div>
                      ))}
                      {s.riskIds.length > 0 && (
                        <div className="mt-1 text-[10px] text-neutral-400">{s.riskIds.map((id) => `${id} ${registerTitles.get(id) ?? ""}`).join("; ")}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <RatingBadge score={s.initialScore} />
                    </td>
                    <td className="px-3 py-2 text-neutral-700">
                      {s.controls.map((c) => (
                        <div key={c.text}>{c.text}</div>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <RatingBadge score={s.residualScore} />
                    </td>
                  </tr>
                ))}
                {ta.steps.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-neutral-400">
                      No job steps yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Sidebar: handoff + timeline */}
      <aside className="space-y-5">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Make.com handoff</p>
            {ta.status !== "draft" && ta.status !== "closed" && (
              <button
                onClick={() => call("resend", `/api/tas/${ta.id}/resend`)}
                disabled={!!busy}
                className="text-xs text-accent font-medium hover:underline disabled:opacity-50"
              >
                {busy === "resend" ? "Sending…" : "Resend"}
              </button>
            )}
          </div>
          {ta.deliveries.length === 0 ? (
            <p className="text-xs text-neutral-400">Nothing sent yet — sent automatically on submit and review.</p>
          ) : (
            <ul className="space-y-1.5">
              {ta.deliveries.slice(0, 8).map((d) => (
                <li key={d.id} className="text-xs flex items-start justify-between gap-2">
                  <span className="text-neutral-600">
                    {d.event}
                    <span className="block text-[10px] text-neutral-400">{new Date(d.createdAt).toLocaleString("en-NZ")}</span>
                  </span>
                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded border ${
                      d.status === "sent"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : d.status === "failed"
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-neutral-100 text-neutral-500 border-neutral-200"
                    }`}
                    title={d.error || d.responseSnippet || undefined}
                  >
                    {d.status}
                    {d.httpStatus ? ` ${d.httpStatus}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium mb-2">Timeline</p>
          <ol className="space-y-2">
            {ta.events.map((e) => (
              <li key={e.id} className="text-xs">
                <p className="text-neutral-800">{EVENT_LABELS[e.type] ?? e.type}</p>
                <p className="text-[10px] text-neutral-400">
                  {e.actorName} · {new Date(e.createdAt).toLocaleString("en-NZ")}
                </p>
                {e.detail && <p className="text-neutral-500 mt-0.5 break-words">{e.detail}</p>}
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-neutral-400 uppercase tracking-wide">{label}</dt>
      <dd className="text-neutral-800 whitespace-pre-wrap">{value || <span className="text-neutral-300">—</span>}</dd>
    </div>
  );
}

function StatusBanner({ ta }: { ta: TaFull }) {
  const styles: Record<string, string> = {
    draft: "border-slate-200 bg-slate-50 text-slate-700",
    submitted: "border-amber-200 bg-amber-50 text-amber-900",
    changes_requested: "border-red-200 bg-red-50 text-red-800",
    approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
    closed: "border-neutral-200 bg-neutral-50 text-neutral-600",
  };
  const detail =
    ta.status === "submitted"
      ? `Submitted ${ta.submittedAt ? new Date(ta.submittedAt).toLocaleString("en-NZ") : ""} by ${ta.preparedByName}. Locked while H&S reviews it.`
      : ta.status === "approved"
        ? `Approved by ${ta.reviewedByName} ${ta.reviewedAt ? `on ${new Date(ta.reviewedAt).toLocaleDateString("en-NZ")}` : ""}.`
        : ta.status === "changes_requested"
          ? `${ta.reviewedByName} asked for changes — edit the TA and resubmit.`
          : ta.status === "closed"
            ? "This job is finished; the TA is kept for the record."
            : "Draft — not yet submitted for H&S review.";
  return (
    <div className={`rounded-xl border px-4 py-3 ${styles[ta.status]}`}>
      <p className="text-sm font-medium">{TA_STATUS_LABELS[ta.status]}</p>
      <p className="text-xs mt-0.5">{detail}</p>
      {ta.reviewComment && (ta.status === "changes_requested" || ta.status === "approved") && (
        <p className="text-sm mt-2 bg-white/60 rounded-md px-2.5 py-1.5">“{ta.reviewComment}”</p>
      )}
    </div>
  );
}
