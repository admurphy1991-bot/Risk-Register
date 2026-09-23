// Pluggable inbound adapters for the existing health & safety system.
//
// Each adapter takes the raw JSON body of a webhook event from one external
// source and normalizes it into a draft risk. This is intentionally a thin,
// swappable layer: when the real system (and its actual payload shape) is
// known, replace the relevant `map()` function below — nothing else in the
// app needs to change, since callers only ever see the normalized shape.
//
// To wire up a NEW source that isn't listed here yet:
//   1. Add its name to `AdapterSource`.
//   2. Add a `map()` implementation (see `generic` for the simplest case).
//   3. Register it in `adapters`.
//   4. Point the external system at POST /api/v1/webhooks/<source>
//      with header `Authorization: Bearer <api key>`.

export type NormalizedDraftRisk = {
  title: string;
  description?: string;
  category?: string;
  location?: string;
  ownerName?: string;
  status?: string;
  sourceEventType: string;
};

export type Adapter = {
  label: string;
  description: string;
  map: (payload: Record<string, unknown>) => NormalizedDraftRisk | null;
};

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

export const adapters: Record<string, Adapter> = {
  // A source-agnostic shape for any system that can send:
  // { eventType, title, description, category, location, owner }
  generic: {
    label: "Generic",
    description: "Source-agnostic JSON shape: { eventType, title, description, category, location, owner }.",
    map(payload) {
      const title = str(payload.title) || str(payload.summary);
      if (!title) return null;
      return {
        title,
        description: str(payload.description),
        category: str(payload.category, "Uncategorised"),
        location: str(payload.location ?? payload.site),
        ownerName: str(payload.owner ?? payload.assignee),
        status: "Draft",
        sourceEventType: str(payload.eventType, "webhook.received"),
      };
    },
  },

  // Placeholder for CONQA (site inspection / quality platform). Replace the
  // field mapping once real CONQA webhook payloads/docs are available —
  // e.g. a failed inspection checklist item becoming a draft risk.
  conqa: {
    label: "CONQA",
    description:
      "Placeholder mapping for CONQA site inspections. Update this once CONQA's actual webhook/export payload shape is confirmed.",
    map(payload) {
      const title =
        str(payload.itemTitle) || str(payload.checklistItem) || str(payload.title) || "CONQA inspection finding";
      return {
        title: `CONQA: ${title}`,
        description: str(payload.notes) || str(payload.comment),
        category: str(payload.category, "Plant and equipment"),
        location: str(payload.project) || str(payload.site),
        ownerName: str(payload.inspector),
        status: "Draft",
        sourceEventType: str(payload.eventType, "conqa.finding"),
      };
    },
  },

  // Placeholder for SafetyCulture (shown as the vendor's example integration
  // in the reference screenshots). Update once real payloads are confirmed.
  safetyculture: {
    label: "SafetyCulture",
    description: "Placeholder mapping for SafetyCulture inspections/incidents.",
    map(payload) {
      const title = str(payload.title) || str(payload.template_name) || "SafetyCulture item";
      return {
        title: `SafetyCulture: ${title}`,
        description: str(payload.description),
        category: str(payload.category, "Uncategorised"),
        location: str(payload.site_name) || str(payload.location),
        ownerName: str(payload.assignee),
        status: "Draft",
        sourceEventType: str(payload.event_type, "safetyculture.event"),
      };
    },
  },
};

export function getAdapter(source: string): Adapter | null {
  return adapters[source.toLowerCase()] ?? null;
}
