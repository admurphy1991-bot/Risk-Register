import { SignJWT, jwtVerify } from "jose";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { uid } from "@/lib/ids";
import { ratingLabel } from "@/lib/risk-scoring";
import { getTaWorkflowSettings } from "@/lib/settings";
import { buildTaDocx, taDocxFilename } from "@/lib/ta-docx";
import { TA_STATUS_LABELS, getRegisterRiskMap, type TaFull } from "@/lib/ta";

// The Make.com handoff. On submit / approve / changes-requested the app POSTs
// one JSON payload to the configured Make.com custom webhook. The payload
// carries the Word document (base64 + a signed download link), the recipient
// addresses (M-Files inbox, H&S manager, the preparing PM) and ready-to-use
// email subjects/bodies, so the Make scenario only has to route and send.

export type TaWebhookEvent = "ta.submitted" | "ta.approved" | "ta.changes_requested" | "test";

const secret = new TextEncoder().encode(process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me");

export async function signDocToken(taId: string): Promise<string> {
  return new SignJWT({ taId, purpose: "ta-doc" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifyDocToken(token: string, taId: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload.purpose === "ta-doc" && payload.taId === taId;
  } catch {
    return false;
  }
}

export async function renderTaDocument(ta: TaFull) {
  const allIds = [...new Set(ta.steps.flatMap((s) => s.riskIds))];
  const riskMap = await getRegisterRiskMap(allIds);
  const titles = new Map([...riskMap.entries()].map(([id, r]) => [id, r.title]));
  const buffer = await buildTaDocx(ta, titles);
  return { buffer, filename: taDocxFilename(ta), riskMap };
}

async function preparerEmail(ta: TaFull): Promise<string | null> {
  if (!ta.preparedById) return null;
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, ta.preparedById)).limit(1);
  return rows[0]?.email ?? null;
}

export async function buildTaPayload(ta: TaFull, event: TaWebhookEvent, baseUrl: string) {
  const settings = await getTaWorkflowSettings();
  const { buffer, filename, riskMap } = await renderTaDocument(ta);
  const token = await signDocToken(ta.id);
  const title = [ta.jobNumber, ta.projectName].filter(Boolean).join(" - ") || ta.id;
  const viewUrl = `${baseUrl}/tas/${ta.id}`;
  const maxInitial = Math.max(0, ...ta.steps.map((s) => s.initialScore ?? 0)) || null;
  const maxResidual = Math.max(0, ...ta.steps.map((s) => s.residualScore ?? 0)) || null;
  const registerRiskIds = [...new Set(ta.steps.flatMap((s) => s.riskIds))];

  const reviewLine =
    event === "ta.approved"
      ? `Approved by ${ta.reviewedByName ?? "H&S"}${ta.reviewComment ? `: ${ta.reviewComment}` : "."}`
      : event === "ta.changes_requested"
        ? `Changes requested by ${ta.reviewedByName ?? "H&S"}: ${ta.reviewComment ?? ""}`
        : `Submitted by ${ta.preparedByName} for H&S review.`;

  return {
    event,
    sentAt: new Date().toISOString(),
    ta: {
      id: ta.id,
      title,
      jobNumber: ta.jobNumber,
      projectName: ta.projectName,
      taDate: ta.taDate,
      siteAddress: ta.siteAddress,
      mainContractor: ta.mainContractor,
      siteContactName: ta.siteContactName,
      siteContactPhone: ta.siteContactPhone,
      contractManager: ta.contractManager,
      contractManagerPhone: ta.contractManagerPhone,
      workType: ta.workType,
      overview: ta.overview,
      permits: ta.permits,
      status: ta.status,
      statusLabel: TA_STATUS_LABELS[ta.status],
      preparedBy: ta.preparedByName,
      submittedAt: ta.submittedAt,
      reviewedBy: ta.reviewedByName,
      reviewedAt: ta.reviewedAt,
      reviewComment: ta.reviewComment,
      stepCount: ta.steps.length,
      highestInitialRating: ratingLabel(maxInitial),
      highestResidualRating: ratingLabel(maxResidual),
      registerRiskIds,
      steps: ta.steps.map((s, i) => ({
        number: i + 1,
        description: s.description,
        identifiedRisks: s.identifiedRisks,
        initialRating: ratingLabel(s.initialScore),
        residualRating: ratingLabel(s.residualScore),
        controls: s.controls.map((c) => c.text),
        registerRisks: s.riskIds.map((id) => ({ id, title: riskMap.get(id)?.title ?? "" })),
      })),
    },
    document: {
      filename,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: buffer.length,
      base64: buffer.toString("base64"),
      downloadUrl: `${baseUrl}/api/tas/${ta.id}/document?token=${encodeURIComponent(token)}`,
    },
    links: { viewUrl, reviewUrl: viewUrl },
    recipients: {
      mfilesEmail: settings.mfilesEmail || null,
      hsManagerEmail: settings.hsManagerEmail || null,
      hsManagerName: settings.hsManagerName || null,
      preparedByEmail: await preparerEmail(ta),
    },
    email: {
      mfilesSubject: `TA/SWMS ${title} (${ta.id})`,
      hsReviewSubject: `TA for review: ${title} (${ta.id})`,
      preparerSubject:
        event === "ta.approved" ? `TA approved: ${title} (${ta.id})` : event === "ta.changes_requested" ? `TA needs changes: ${title} (${ta.id})` : `TA submitted: ${title} (${ta.id})`,
      bodyText: [
        `${ta.id} — ${title}`,
        `Site: ${ta.siteAddress || "—"}`,
        `Prepared by: ${ta.preparedByName || "—"}`,
        `Steps: ${ta.steps.length} · Highest initial rating: ${ratingLabel(maxInitial)} · Highest residual rating: ${ratingLabel(maxResidual)}`,
        reviewLine,
        `Review / approve in the Risk Register: ${viewUrl}`,
      ].join("\n"),
    },
  };
}

async function logDelivery(row: Omit<typeof schema.outboundDeliveries.$inferInsert, "id" | "createdAt">) {
  await db.insert(schema.outboundDeliveries).values({ id: uid("dlv"), createdAt: new Date().toISOString(), ...row });
}

/** POSTs a payload to the Make.com webhook and records the outcome. Never throws. */
export async function deliverToMake(event: TaWebhookEvent, taId: string | null, payload: unknown) {
  const { makeWebhookUrl } = await getTaWorkflowSettings();
  if (!makeWebhookUrl) {
    await logDelivery({ event, taId, url: "(not configured)", status: "skipped", error: "No Make.com webhook URL set in Settings." });
    return { status: "skipped" as const, message: "No Make.com webhook URL is configured — nothing was sent." };
  }
  try {
    const res = await fetch(makeWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sansom-Event": event },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const text = (await res.text()).slice(0, 500);
    await logDelivery({ event, taId, url: makeWebhookUrl, status: res.ok ? "sent" : "failed", httpStatus: res.status, responseSnippet: text });
    return res.ok
      ? { status: "sent" as const, message: `Sent to Make.com (HTTP ${res.status}).` }
      : { status: "failed" as const, message: `Make.com responded HTTP ${res.status}: ${text}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logDelivery({ event, taId, url: makeWebhookUrl, status: "failed", error: message });
    return { status: "failed" as const, message: `Couldn't reach Make.com: ${message}` };
  }
}
