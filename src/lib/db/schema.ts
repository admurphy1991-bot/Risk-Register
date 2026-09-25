import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ---------- Users ----------
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"), // admin | manager | viewer
  createdAt: text("created_at").notNull(),
});

// ---------- Config lists ----------
export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("slate"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const locations = sqliteTable("locations", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ---------- Risks ----------
export const risks = sqliteTable("risks", {
  id: text("id").primaryKey(), // e.g. RSK-101
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default(""),
  location: text("location").notNull().default(""),
  ownerName: text("owner_name").notNull().default(""),

  inherentLikelihood: integer("inherent_likelihood"), // 1-5
  inherentConsequence: integer("inherent_consequence"), // 1-5
  inherentScore: integer("inherent_score"), // computed L*C

  residualLikelihood: integer("residual_likelihood"),
  residualConsequence: integer("residual_consequence"),
  residualScore: integer("residual_score"),

  status: text("status").notNull().default("Draft"), // Draft | Active | Under treatment | Monitored | Closed
  nextReviewDate: text("next_review_date"), // ISO date string

  source: text("source").notNull().default("manual"), // manual | ai | api | import
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ---------- Controls ----------
export const controls = sqliteTable("controls", {
  id: text("id").primaryKey(),
  riskId: text("risk_id").notNull(),
  description: text("description").notNull(),
  type: text("type").notNull().default("administrative"), // elimination | substitution | engineering | administrative | ppe
  implemented: integer("implemented", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

// ---------- Change log / audit trail (also powers AI plan apply/undo) ----------
export const changePlans = sqliteTable("change_plans", {
  id: text("id").primaryKey(),
  actorType: text("actor_type").notNull(), // user | ai | api | import
  actorName: text("actor_name").notNull(),
  prompt: text("prompt"), // the natural-language request, for AI plans
  summary: text("summary").notNull(),
  status: text("status").notNull().default("applied"), // proposed | applied | undone
  createdAt: text("created_at").notNull(),
});

export const changeOps = sqliteTable("change_ops", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  op: text("op").notNull(), // create | update | delete
  entityType: text("entity_type").notNull(), // risk | control
  entityId: text("entity_id").notNull(),
  before: text("before"), // JSON snapshot before change (null for create)
  after: text("after"), // JSON snapshot after change (null for delete)
  createdAt: text("created_at").notNull(),
});

// ---------- API keys (for external H&S system / integrations) ----------
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  scopes: text("scopes").notNull().default("read,write"), // comma separated
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
});

// ---------- Inbound webhook events from the external H&S system ----------
export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  source: text("source").notNull(), // e.g. "conqa", "safetyculture", "generic"
  eventType: text("event_type").notNull(), // e.g. "incident.created", "inspection.failed_item"
  payload: text("payload").notNull(), // raw JSON as received
  status: text("status").notNull().default("received"), // received | mapped | ignored | error
  resultRiskId: text("result_risk_id"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
});

// ---------- Outbound integration config (pluggable adapter settings) ----------
export const integrationConfig = sqliteTable("integration_config", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("generic"), // generic | conqa | safetyculture | ...
  baseUrl: text("base_url"),
  apiKey: text("api_key"), // credential for calling OUT to the external system
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  settings: text("settings"), // JSON blob for adapter-specific config
  updatedAt: text("updated_at").notNull(),
});

// ============================================================================
// Task Analysis (TA / SWMS) builder
// ============================================================================

// One TA per job (or per stage of a job). Header fields mirror the "project
// details" table at the top of Sansom's TA/SWMS template.
export const taskAnalyses = sqliteTable("task_analyses", {
  id: text("id").primaryKey(), // e.g. TA-0001
  jobNumber: text("job_number").notNull().default(""), // e.g. S34144
  projectName: text("project_name").notNull().default(""),
  taDate: text("ta_date"), // ISO date
  siteAddress: text("site_address").notNull().default(""),
  mainContractor: text("main_contractor").notNull().default(""),
  siteContactName: text("site_contact_name").notNull().default(""),
  siteContactPhone: text("site_contact_phone").notNull().default(""),
  contractManager: text("contract_manager").notNull().default(""),
  contractManagerPhone: text("contract_manager_phone").notNull().default(""),
  workType: text("work_type").notNull().default(""),
  overview: text("overview").notNull().default(""),
  permits: text("permits").notNull().default("[]"), // JSON string[]
  legislation: text("legislation").notNull().default("[]"), // JSON string[]
  plant: text("plant").notNull().default("[]"), // JSON {item, operatorRequirements}[]
  chemicals: text("chemicals").notNull().default("[]"), // JSON {name, sds}[]
  ppe: text("ppe").notNull().default("[]"), // JSON string[] of PPE keys
  responsibleCompliance: text("responsible_compliance").notNull().default(""),
  responsibleReview: text("responsible_review").notNull().default(""),
  reviewFrequency: text("review_frequency").notNull().default(""),
  status: text("status").notNull().default("draft"), // draft | submitted | changes_requested | approved | closed
  preparedById: text("prepared_by_id"),
  preparedByName: text("prepared_by_name").notNull().default(""),
  aiFilledFields: text("ai_filled_fields").notNull().default("[]"), // JSON string[] of header fields the AI filled
  submittedAt: text("submitted_at"),
  reviewedAt: text("reviewed_at"),
  reviewedByName: text("reviewed_by_name"),
  reviewComment: text("review_comment"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// One row per job step in the TA's main table.
export const taSteps = sqliteTable("ta_steps", {
  id: text("id").primaryKey(),
  taId: text("ta_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  description: text("description").notNull().default(""),
  identifiedRisks: text("identified_risks").notNull().default("[]"), // JSON string[]
  controls: text("controls").notNull().default("[]"), // JSON {text, riskId|null}[]
  initialLikelihood: integer("initial_likelihood"),
  initialConsequence: integer("initial_consequence"),
  initialScore: integer("initial_score"),
  residualLikelihood: integer("residual_likelihood"),
  residualConsequence: integer("residual_consequence"),
  residualScore: integer("residual_score"),
});

// Which register risks each step draws on — the basis for the cross-site
// "active risks" rollup.
export const taStepRisks = sqliteTable("ta_step_risks", {
  id: text("id").primaryKey(),
  taId: text("ta_id").notNull(),
  stepId: text("step_id").notNull(),
  riskId: text("risk_id").notNull(),
});

// Supporting documents dropped into "Create TA" (proposal, scope, emails...).
export const taFiles = sqliteTable("ta_files", {
  id: text("id").primaryKey(),
  taId: text("ta_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storedPath: text("stored_path").notNull(),
  extractedText: text("extracted_text"), // plain text used for AI extraction (null for PDFs/images, sent natively)
  createdAt: text("created_at").notNull(),
});

// Audit timeline for a TA (created, AI extraction, submitted, reviewed...).
export const taEvents = sqliteTable("ta_events", {
  id: text("id").primaryKey(),
  taId: text("ta_id").notNull(),
  type: text("type").notNull(),
  actorName: text("actor_name").notNull(),
  detail: text("detail"),
  createdAt: text("created_at").notNull(),
});

// Outbound webhook deliveries (Make.com handoff) — logged so failures can be
// seen and resent.
export const outboundDeliveries = sqliteTable("outbound_deliveries", {
  id: text("id").primaryKey(),
  event: text("event").notNull(), // ta.submitted | ta.approved | ta.changes_requested | test
  taId: text("ta_id"),
  url: text("url").notNull(),
  status: text("status").notNull(), // sent | failed | skipped
  httpStatus: integer("http_status"),
  responseSnippet: text("response_snippet"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
});

// Simple key/value store for settings editable in the app (webhook URL, emails).
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
