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
export { schema };

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
  CREATE INDEX IF NOT EXISTS idx_controls_risk_id ON controls(risk_id);
  CREATE INDEX IF NOT EXISTS idx_change_ops_plan_id ON change_ops(plan_id);
  `);
}

ensureSchema();
