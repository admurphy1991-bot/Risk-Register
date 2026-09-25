import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/auth";
import { TOOLS, executeTool } from "@/lib/ai-tools";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Risk AI, an assistant built into a workplace health & safety risk register (in the style of tools like Frontline / Cority / Vault). You help the register's owner search, understand, and edit risk records through conversation.

Rules:
- Before creating a new risk, use search_risks to check whether something similar already exists, and mention it if so.
- Likelihood and consequence are each rated 1-5. Score = likelihood x consequence. This is Sansom's own matrix: likelihood 1 Rare, 2 Unlikely, 3 Possible, 4 Likely, 5 Almost Certain; consequence 1 Minor, 2 Medium, 3 Serious, 4 Major, 5 Catastrophic. Bands: 1-3 Low, 4-6 Moderate, 8-12 High, 15-25 Critical.
- Never invent a risk ID yourself — the system assigns the next RSK-### id automatically when you propose a create.
- You cannot write to the register directly. To create, edit, or delete anything, you MUST call propose_change_plan. This stages a plan the user reviews and applies themselves — never claim something has been saved unless propose_change_plan actually returned a planId.
- Keep replies concise and specific. When you propose a plan, briefly explain what it will do; the UI will render the actual diff for the user to review.
- If a request is ambiguous (e.g. which location, which risk), ask a brief clarifying question rather than guessing.`;

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server. Set it in your environment and restart." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  const message = (body?.message || "").toString().trim();
  const history: ChatMessage[] = Array.isArray(body?.history) ? body.history : [];
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content }) as Anthropic.MessageParam),
    { role: "user", content: message },
  ];

  let finalText = "";
  const proposedPlans: { planId: string; summary: string; opsCount: number }[] = [];

  try {
    for (let turn = 0; turn < 6; turn++) {
      const response = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      finalText = textBlocks.map((b) => b.text).join("\n").trim() || finalText;

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const result = await executeTool(use.name, (use.input as Record<string, unknown>) || {});
        if (use.name === "propose_change_plan" && result && typeof result === "object" && "planId" in result) {
          const r = result as { planId: string; opsCount: number };
          proposedPlans.push({ planId: r.planId, summary: String((use.input as Record<string, unknown>)?.summary || ""), opsCount: r.opsCount });
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
  } catch (err) {
    console.error("chat route error:", err);
    const message = err instanceof Anthropic.APIError ? `${err.status} ${err.name}: ${err.message}` : String(err instanceof Error ? err.message : err);
    return NextResponse.json({ error: `Chat failed: ${message}` }, { status: 500 });
  }

  return NextResponse.json({
    reply: finalText || "(no response)",
    proposedPlans,
  });
}
