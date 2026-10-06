-- Criativos (Social Media Hub): social accounts, credentials, library,
-- campaigns, publications and their approval / attempt history.
-- Same shape as every other collection: the record lives in `data` (JSON).

CREATE TABLE IF NOT EXISTS social_accounts      (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
-- OAuth tokens, sealed with AES-256-GCM. Kept apart from the accounts so they
-- are never serialized together with data sent to the browser.
CREATE TABLE IF NOT EXISTS social_credentials   (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
-- Media already on the social network (synced from the official API).
CREATE TABLE IF NOT EXISTS social_media         (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS creatives            (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS campaigns            (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS publications         (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS publication_approvals (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));
CREATE TABLE IF NOT EXISTS publication_attempts (id TEXT PRIMARY KEY, pos REAL NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)));

CREATE INDEX IF NOT EXISTS ix_social_accounts_ws     ON social_accounts (json_extract(data, '$.workspaceId'));
-- One connection per network account inside a workspace.
CREATE UNIQUE INDEX IF NOT EXISTS ux_social_accounts_provider ON social_accounts (json_extract(data, '$.workspaceId'), json_extract(data, '$.provider'), json_extract(data, '$.providerAccountId')) WHERE json_extract(data, '$.status') <> 'DISCONNECTED';
CREATE UNIQUE INDEX IF NOT EXISTS ux_social_credentials_account ON social_credentials (json_extract(data, '$.accountId'));
CREATE INDEX IF NOT EXISTS ix_social_media_account   ON social_media (json_extract(data, '$.accountId'), json_extract(data, '$.timestamp'));
CREATE UNIQUE INDEX IF NOT EXISTS ux_social_media_external ON social_media (json_extract(data, '$.accountId'), json_extract(data, '$.externalId'));

CREATE INDEX IF NOT EXISTS ix_creatives_ws           ON creatives (json_extract(data, '$.workspaceId'), json_extract(data, '$.createdAt'));
CREATE INDEX IF NOT EXISTS ix_creatives_campaign     ON creatives (json_extract(data, '$.campaignId'));
CREATE INDEX IF NOT EXISTS ix_creatives_project      ON creatives (json_extract(data, '$.projectId'));

CREATE INDEX IF NOT EXISTS ix_campaigns_ws           ON campaigns (json_extract(data, '$.workspaceId'), json_extract(data, '$.status'));
CREATE INDEX IF NOT EXISTS ix_campaigns_project      ON campaigns (json_extract(data, '$.projectId'));

CREATE INDEX IF NOT EXISTS ix_publications_ws        ON publications (json_extract(data, '$.workspaceId'), json_extract(data, '$.status'));
CREATE INDEX IF NOT EXISTS ix_publications_account   ON publications (json_extract(data, '$.socialAccountId'), json_extract(data, '$.scheduledAt'));
CREATE INDEX IF NOT EXISTS ix_publications_due       ON publications (json_extract(data, '$.status'), json_extract(data, '$.scheduledAt'));
CREATE INDEX IF NOT EXISTS ix_publications_campaign  ON publications (json_extract(data, '$.campaignId'));
CREATE INDEX IF NOT EXISTS ix_publications_project   ON publications (json_extract(data, '$.projectId'));
CREATE INDEX IF NOT EXISTS ix_publications_task      ON publications (json_extract(data, '$.taskId'));
CREATE INDEX IF NOT EXISTS ix_publications_created   ON publications (json_extract(data, '$.createdAt'));

CREATE INDEX IF NOT EXISTS ix_pub_approvals_pub      ON publication_approvals (json_extract(data, '$.publicationId'));
CREATE INDEX IF NOT EXISTS ix_pub_attempts_pub       ON publication_attempts (json_extract(data, '$.publicationId'));
-- The idempotency key of an attempt can only be used once.
CREATE UNIQUE INDEX IF NOT EXISTS ux_pub_attempts_key ON publication_attempts (json_extract(data, '$.idempotencyKey'));
