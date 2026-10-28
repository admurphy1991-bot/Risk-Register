import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getChemicalsByIds } from "@/lib/chemicals";
import { getRisksForSssp, type SsspFull } from "@/lib/sssp";
import { TA_STATUS_LABELS, getTaFull } from "@/lib/ta";
import { buildSsspDocx, ssspDocxFilename } from "@/lib/sssp-docx";
import { getTaWorkflowSettings } from "@/lib/settings";
import { signDocToken, type TaWebhookEvent } from "@/lib/ta-webhook";

// SSSP documents and the Make.com payload. The payload deliberately mirrors
// the TA one (document / recipients / email / links) so the same Make
// scenario can route it — only `event` (sssp.*) and the `sssp` block differ.

export async function renderSsspDocument(s: SsspFull) {
  const [risks, chemicals] = await Promise.all([getRisksForSssp(s.data.riskIds), getChemicalsByIds(s.data.chemicalIds)]);
  const tas = [];
  for (const id of s.data.taIds) {
    const ta = await getTaFull(id);
    if (ta)
      tas.push({
        id: ta.id,
        title: [ta.jobNumber, ta.projectName].filter(Boolean).join(" ") || ta.id,
        status: TA_STATUS_LABELS[ta.status],
        reviewedByName: ta.reviewedByName,
        reviewedAt: ta.reviewedAt,
      });
  }
  const buffer = await buildSsspDocx(s, { risks, chemicals, tas });
  return { buffer, filename: ssspDocxFilename(s), risks, chemicals };
}

export async function buildSsspPayload(s: SsspFull, event: TaWebhookEvent, baseUrl: string) {
  const settings = await getTaWorkflowSettings();
  const { buffer, filename, risks, chemicals } = await renderSsspDocument(s);
  const token = await signDocToken(s.id);
  const title = [s.jobNumber, s.projectName].filter(Boolean).join(" - ") || s.id;
  const viewUrl = `${baseUrl}/sssps/${s.id}`;
  const preparer = s.preparedById ? (await db.select().from(schema.users).where(eq(schema.users.id, s.preparedById)).limit(1))[0] : null;
  const reviewLine =
    event === "sssp.approved"
      ? `Approved by ${s.reviewedByName ?? "H&S"}${s.reviewComment ? `: ${s.reviewComment}` : "."}`
      : event === "sssp.changes_requested"
        ? `Changes requested by ${s.reviewedByName ?? "H&S"}: ${s.reviewComment ?? ""}`
        : `Submitted by ${s.preparedByName} for H&S review.`;

  return {
    event,
    kind: "sssp",
    sentAt: new Date().toISOString(),
    sssp: {
      id: s.id,
      title,
      jobNumber: s.jobNumber,
      projectName: s.projectName,
      siteAddress: s.siteAddress,
      mainContractor: s.mainContractor,
      projectManager: s.data.projectManager,
      startDate: s.data.startDate,
      endDate: s.data.endDate,
      workTypes: s.data.workTypes,
      status: s.status,
      statusLabel: TA_STATUS_LABELS[s.status],
      preparedBy: s.preparedByName,
      submittedAt: s.submittedAt,
      reviewedBy: s.reviewedByName,
      reviewedAt: s.reviewedAt,
      reviewComment: s.reviewComment,
      registerRiskIds: risks.map((r) => r.id),
      chemicals: chemicals.map((c) => ({ id: c.id, name: c.productName, unNumber: c.unNumber })),
      taIds: s.data.taIds,
    },
    // Same field the TA routes read, so the changes-requested email works unchanged.
    ta: { reviewComment: s.reviewComment, title },
    document: {
      filename,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: buffer.length,
      base64: buffer.toString("base64"),
      downloadUrl: `${baseUrl}/api/sssps/${s.id}/document?token=${encodeURIComponent(token)}`,
    },
    links: { viewUrl, reviewUrl: viewUrl },
    recipients: {
      mfilesEmail: settings.mfilesEmail || null,
      hsManagerEmail: settings.hsManagerEmail || null,
      hsManagerName: settings.hsManagerName || null,
      preparedByEmail: preparer?.email ?? null,
    },
    email: {
      mfilesSubject: `SSSP ${title} (${s.id})`,
      hsReviewSubject: `SSSP for review: ${title} (${s.id})`,
      preparerSubject:
        event === "sssp.approved" ? `SSSP approved: ${title} (${s.id})` : event === "sssp.changes_requested" ? `SSSP needs changes: ${title} (${s.id})` : `SSSP submitted: ${title} (${s.id})`,
      bodyText: [
        `${s.id} — Site Specific Safety Plan — ${title}`,
        `Site: ${s.siteAddress || "—"}`,
        `Prepared by: ${s.preparedByName || "—"}`,
        `Site risks: ${risks.length} · Hazardous substances: ${chemicals.length} · Linked TAs: ${s.data.taIds.join(", ") || "none"}`,
        reviewLine,
        `Review / approve in the Risk Register: ${viewUrl}`,
      ].join("\n"),
    },
  };
}
