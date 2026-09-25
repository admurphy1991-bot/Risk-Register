import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

// Statically scoped to ./data so bundlers don't trace the whole project when
// resolving this path. Set DATABASE_URL to an absolute path to store the
// SQLite file elsewhere (e.g. a persistent volume in production).
const envPath = process.env.DATABASE_URL;
const resolved =
  envPath && path.isAbsolute(envPath)
    ? envPath
    : path.join(process.cwd(), /* turbopackIgnore: true */ "data", "risk-register.db");
fs.mkdirSync(path.dirname(resolved), { recursive: true });

const sqlite = new Database(resolved);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema, sqlite };

/** Directory that holds the database file — uploaded TA files live alongside it
 * so they end up on the same persistent volume in production. */
export const dataDir = path.dirname(resolved);

export function ensureSchema() {
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT 'slate',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS risks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    owner_name TEXT NOT NULL DEFAULT '',
    inherent_likelihood INTEGER,
    inherent_consequence INTEGER,
    inherent_score INTEGER,
    residual_likelihood INTEGER,
    residual_consequence INTEGER,
    residual_score INTEGER,
    status TEXT NOT NULL DEFAULT 'Draft',
    next_review_date TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS controls (
    id TEXT PRIMARY KEY,
    risk_id TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'administrative',
    implemented INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS change_plans (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    prompt TEXT,
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'applied',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS change_ops (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    op TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before TEXT,
    after TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT 'read,write',
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received',
    result_risk_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS integration_config (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'generic',
    base_url TEXT,
    api_key TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    settings TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_analyses (
    id TEXT PRIMARY KEY,
    job_number TEXT NOT NULL DEFAULT '',
    project_name TEXT NOT NULL DEFAULT '',
    ta_date TEXT,
    site_address TEXT NOT NULL DEFAULT '',
    main_contractor TEXT NOT NULL DEFAULT '',
    site_contact_name TEXT NOT NULL DEFAULT '',
    site_contact_phone TEXT NOT NULL DEFAULT '',
    contract_manager TEXT NOT NULL DEFAULT '',
    contract_manager_phone TEXT NOT NULL DEFAULT '',
    work_type TEXT NOT NULL DEFAULT '',
    overview TEXT NOT NULL DEFAULT '',
    permits TEXT NOT NULL DEFAULT '[]',
    legislation TEXT NOT NULL DEFAULT '[]',
    plant TEXT NOT NULL DEFAULT '[]',
    chemicals TEXT NOT NULL DEFAULT '[]',
    ppe TEXT NOT NULL DEFAULT '[]',
    responsible_compliance TEXT NOT NULL DEFAULT '',
    responsible_review TEXT NOT NULL DEFAULT '',
    review_frequency TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    prepared_by_id TEXT,
    prepared_by_name TEXT NOT NULL DEFAULT '',
    ai_filled_fields TEXT NOT NULL DEFAULT '[]',
    submitted_at TEXT,
    reviewed_at TEXT,
    reviewed_by_name TEXT,
    review_comment TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ta_steps (
    id TEXT PRIMARY KEY,
    ta_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    identified_risks TEXT NOT NULL DEFAULT '[]',
    controls TEXT NOT NULL DEFAULT '[]',
    initial_likelihood INTEGER,
    initial_consequence INTEGER,
    initial_score INTEGER,
    residual_likelihood INTEGER,
    residual_consequence INTEGER,
    residual_score INTEGER
  );
  CREATE TABLE IF NOT EXISTS ta_step_risks (
    id TEXT PRIMARY KEY,
    ta_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    risk_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ta_files (
    id TEXT PRIMARY KEY,
    ta_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    stored_path TEXT NOT NULL,
    extracted_text TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ta_events (
    id TEXT PRIMARY KEY,
    ta_id TEXT NOT NULL,
    type TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outbound_deliveries (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    ta_id TEXT,
    url TEXT NOT NULL,
    status TEXT NOT NULL,
    http_status INTEGER,
    response_snippet TEXT,
    error TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ta_steps_ta ON ta_steps(ta_id);
  CREATE INDEX IF NOT EXISTS idx_ta_step_risks_ta ON ta_step_risks(ta_id);
  CREATE INDEX IF NOT EXISTS idx_ta_step_risks_risk ON ta_step_risks(risk_id);
  CREATE INDEX IF NOT EXISTS idx_ta_files_ta ON ta_files(ta_id);
  CREATE INDEX IF NOT EXISTS idx_ta_events_ta ON ta_events(ta_id);
  CREATE INDEX IF NOT EXISTS idx_controls_risk_id ON controls(risk_id);
  CREATE INDEX IF NOT EXISTS idx_change_ops_plan_id ON change_ops(plan_id);
  `);
}

ensureSchema();
