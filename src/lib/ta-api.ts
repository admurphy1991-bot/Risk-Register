import { NextResponse } from "next/server";
import { getSession, type SessionUser } from "@/lib/auth";
import { getTaFull, EDITABLE_TA_STATUSES, type TaFull } from "@/lib/ta";

// Shared guards for the /api/tas routes.

export const REVIEWER_ROLES = ["admin", "hs"];

export function canReview(user: SessionUser) {
  return REVIEWER_ROLES.includes(user.role);
}

type Loaded = { user: SessionUser; ta: TaFull; error?: undefined } | { error: NextResponse; user?: undefined; ta?: undefined };

/** Loads the signed-in user and the TA, or returns a ready error response. */
export async function loadTaForRequest(id: string, opts: { editable?: boolean } = {}): Promise<Loaded> {
  const user = await getSession();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const ta = await getTaFull(id);
  if (!ta) return { error: NextResponse.json({ error: "Task analysis not found" }, { status: 404 }) };
  if (opts.editable && !EDITABLE_TA_STATUSES.includes(ta.status)) {
    return {
      error: NextResponse.json(
        { error: `This TA is ${ta.status.replace("_", " ")} and can't be edited. ${ta.status === "submitted" ? "H&S can request changes to reopen it." : ""}`.trim() },
        { status: 409 }
      ),
    };
  }
  return { user, ta };
}
