import type Anthropic from "@anthropic-ai/sdk";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { proposeChangePlan, type ChangeOpInput } from "@/lib/change-log";
import { scoreLevel } from "@/lib/risk-scoring";

// Tool definitions handed to Claude, and the server-side functions that
// execute them. Only propose_change_plan can touch data, and even then it
// only *proposes* — it writes a diff to the change_plans/change_ops tables
// but never mutates a risk or control until the user clicks Apply in the UI.

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_risks",
    description:
      "Search the risk register. Use this to check whether a similar risk already exists before proposing a new one, or to answer questions about current risks. Returns id, title, category, location, owner, status, and scores — not full detail.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text match against risk title/description." },
        category: { type: "string", description: "Filter by exact category name." },
        location: { type: "string", description: "Filter by exact location name." },
        status: { type: "string", description: "Filter by status (Draft, Active, Under treatment, Monitored, Closed)." },
      },
    },
  },
  {
    name: "get_risk",
    description: "Get full detail for one risk by its ID (e.g. RSK-014), including its controls.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "list_categories_and_locations",
    description: "List the categories and locations already configured in the register, so new risks use consistent names.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "propose_change_plan",
    description:
      "Propose a set of creates/updates/deletes to risks and/or controls. This does NOT write to the register — it stages a reviewable plan that the user must explicitly apply in the UI (mirrors the 'change plan' pattern: nothing is written until they hit Apply). Always use this instead of describing changes in prose when the user asks you to add, edit, or remove something. Likelihood and consequence are each 1-5 (1=rare/insignificant, 5=almost certain/catastrophic); score is computed automatically as likelihood x consequence.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line human-readable summary of the plan, e.g. 'Create 3 standard site risks for Brookvale'." },
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["create_risk", "update_risk", "delete_risk", "create_control", "update_control", "delete_control"] },
              id: { type: "string", description: "Required for update_risk, delete_risk, update_control, delete_control." },
              data: {
                type: "object",
                description: "Fields to set. For risks: title, description, category, location, ownerName, inherentLikelihood, inherentConsequence, residualLikelihood, residualConsequence, status, nextReviewDate (YYYY-MM-DD). For controls: riskId, description, type (elimination|substitution|engineering|administrative|ppe), implemented.",
              },
            },
            required: ["op"],
          },
        },
      },
      required: ["summary", "changes"],
    },
  },
];

export async function executeTool(name: string, input: Record<string, unknown>) {
  switch (name) {
    case "search_risks": {
      let rows = await db.select().from(schema.risks);
      if (input.query) {
        const needle = String(input.query).toLowerCase();
        rows = rows.filter(
          (r) => r.title.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle)
        );
      }
      if (input.category) rows = rows.filter((r) => r.category === input.category);
      if (input.location) rows = rows.filter((r) => r.location === input.location);
      if (input.status) rows = rows.filter((r) => r.status === input.status);

      return rows.slice(0, 30).map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        location: r.location,
        ownerName: r.ownerName,
        status: r.status,
        inherentScore: r.inherentScore,
        residualScore: r.residualScore,
        residualLevel: scoreLevel(r.residualScore ?? r.inherentScore ?? null),
        nextReviewDate: r.nextReviewDate,
      }));
    }
    case "get_risk": {
      const id = String(input.id);
      const rows = await db.select().from(schema.risks).where(eq(schema.risks.id, id)).limit(1);
      if (!rows[0]) return { error: `No risk found with id ${id}` };
      const controls = await db.select().from(schema.controls).where(eq(schema.controls.riskId, id));
      return { ...rows[0], controls };
    }
    case "list_categories_and_locations": {
      const categories = await db.select().from(schema.categories);
      const locations = await db.select().from(schema.locations);
      return { categories: categories.map((c) => c.name), locations: locations.map((l) => l.name) };
    }
    case "propose_change_plan": {
      const changes = (input.changes as ChangeOpInput[]) || [];
      const result = await proposeChangePlan({
        actorType: "ai",
        actorName: "Risk AI",
        summary: String(input.summary || "Proposed changes"),
        changes,
      });
      return {
        planId: result.planId,
        status: "proposed",
        opsCount: result.ops.length,
        note: "Plan staged. Nothing has been written yet — it will appear in the UI for the user to review and apply.",
      };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}
