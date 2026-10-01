-- Taskly — initial schema for Cloudflare D1.
--
-- Each collection of the previous JSON database becomes a table. The full
-- record is kept as JSON in `data` (same shape the application already uses),
-- `pos` preserves the collection order, and the fields used for lookups,
-- uniqueness and relationships are indexed in 0002_indexes.sql.
-- See docs/cloudflare.md for the field-by-field mapping.

CREATE TABLE IF NOT EXISTS app_state (
  key   TEXT PRIMARY KEY,          -- 'version' | 'meta' | 'systemSettings'
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO app_state (key, value) VALUES ('version', '0');

-- Identity & access
CREATE TABLE IF NOT EXISTS users               (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS sessions            (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS password_resets     (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS email_verifications (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS mfa_challenges      (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS oauth_states        (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS invitations         (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS api_keys            (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));

-- Workspaces & work
CREATE TABLE IF NOT EXISTS workspaces          (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS projects            (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS task_columns        (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS tasks               (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS milestones          (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS project_templates   (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS files               (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS saved_reports       (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS activity            (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));

-- Automation & integrations
CREATE TABLE IF NOT EXISTS automations         (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS automation_logs     (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS webhooks            (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS webhook_deliveries  (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS notifications       (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS feature_flags       (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));

-- Security, privacy & observability
CREATE TABLE IF NOT EXISTS audit_logs          (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS system_events       (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS security_incidents  (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS privacy_requests    (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
