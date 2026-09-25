import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTaWorkflowSettings, saveTaWorkflowSettings } from "@/lib/settings";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await getTaWorkflowSettings();
  return NextResponse.json({ settings, aiConfigured: !!process.env.ANTHROPIC_API_KEY });
}

export async function PUT(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Only admins can change workflow settings." }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const url = typeof body.makeWebhookUrl === "string" ? body.makeWebhookUrl.trim() : undefined;
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url ?? "");
  if (url && !/^https:\/\/\S+$/i.test(url) && !isLocal) {
    return NextResponse.json({ error: "The Make.com webhook URL should start with https://" }, { status: 400 });
  }
  for (const key of ["mfilesEmail", "hsManagerEmail"] as const) {
    const v = typeof body[key] === "string" ? body[key].trim() : "";
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return NextResponse.json({ error: `${key === "mfilesEmail" ? "M-Files" : "H&S manager"} email doesn't look valid.` }, { status: 400 });
    }
  }

  await saveTaWorkflowSettings({
    makeWebhookUrl: url,
    mfilesEmail: body.mfilesEmail,
    hsManagerEmail: body.hsManagerEmail,
    hsManagerName: body.hsManagerName,
  });
  return NextResponse.json({ settings: await getTaWorkflowSettings() });
}
