import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getBaseUrl } from "@/lib/settings";
import { buildTaPayload, deliverToMake } from "@/lib/ta-webhook";
import { sampleTa } from "@/lib/ta-sample";

export const maxDuration = 60;

/**
 * Sends a sample ta.submitted-shaped payload (event "test") to the Make.com
 * webhook — use it while building the scenario so Make can learn the
 * structure ("Redetermine data structure" on the Custom webhook module).
 */
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Only admins can send test payloads." }, { status: 403 });

  const payload = await buildTaPayload(sampleTa(user.name), "test", getBaseUrl(req));
  const delivery = await deliverToMake("test", null, payload);
  return NextResponse.json({ delivery });
}
