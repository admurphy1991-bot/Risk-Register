import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyChangePlan } from "@/lib/change-log";

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body?.riskId || !body?.description) {
    return NextResponse.json({ error: "riskId and description are required" }, { status: 400 });
  }

  const { planId, applied } = await applyChangePlan({
    actorType: "user",
    actorName: user.name,
    summary: `Added control to ${body.riskId}`,
    changes: [{ op: "create_control", data: body }],
  });

  return NextResponse.json({ planId, control: applied[0]?.after }, { status: 201 });
}
