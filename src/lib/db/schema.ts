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
