import { NextResponse } from "next/server";
import { getSession, type SessionUser } from "@/lib/auth";
import { EDITABLE_TA_STATUSES } from "@/lib/ta-shared";
import { getSsspFull, type SsspFull } from "@/lib/sssp";

type Loaded = { user: SessionUser; sssp: SsspFull; error?: undefined } | { error: NextResponse; user?: undefined; sssp?: undefined };

/** Loads the signed-in user and the SSSP, or returns a ready error response. */
export async function loadSsspForRequest(id: string, opts: { editable?: boolean } = {}): Promise<Loaded> {
  const user = await getSession();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const sssp = await getSsspFull(id);
  if (!sssp) return { error: NextResponse.json({ error: "SSSP not found" }, { status: 404 }) };
  if (opts.editable && !EDITABLE_TA_STATUSES.includes(sssp.status)) {
    return {
      error: NextResponse.json(
        { error: `This SSSP is ${sssp.status.replace("_", " ")} and can't be edited.${sssp.status === "submitted" ? " H&S can request changes to reopen it." : ""}` },
        { status: 409 }
      ),
    };
  }
  return { user, sssp };
}
