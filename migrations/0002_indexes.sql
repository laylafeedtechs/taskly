-- Indexes on the fields used for lookups, uniqueness and relationships.
-- Uniqueness that matters for security is enforced by the database itself:
-- a duplicate e-mail, Google account, session token or API key hash makes
-- the whole request's batch fail (nothing is half-written).

-- Ordering (every table is loaded ORDER BY pos)
CREATE INDEX IF NOT EXISTS ix_users_pos               ON users (pos);
CREATE INDEX IF NOT EXISTS ix_audit_logs_pos          ON audit_logs (pos);
CREATE INDEX IF NOT EXISTS ix_activity_pos            ON activity (pos);
CREATE INDEX IF NOT EXISTS ix_tasks_pos               ON tasks (pos);

-- users
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email      ON users (lower(json_extract(data, '$.email')));
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_google_sub ON users (json_extract(data, '$.googleSub')) WHERE json_extract(data, '$.googleSub') IS NOT NULL;

-- credentials / single-use tokens (only hashes are stored)
CREATE UNIQUE INDEX IF NOT EXISTS ux_sessions_token   ON sessions (json_extract(data, '$.tokenHash'));
CREATE INDEX IF NOT EXISTS ix_sessions_user           ON sessions (json_extract(data, '$.userId'));
CREATE UNIQUE INDEX IF NOT EXISTS ux_api_keys_hash    ON api_keys (json_extract(data, '$.keyHash'));
CREATE INDEX IF NOT EXISTS ix_api_keys_workspace      ON api_keys (json_extract(data, '$.workspaceId'));
CREATE UNIQUE INDEX IF NOT EXISTS ux_invitations_token ON invitations (json_extract(data, '$.tokenHash'));
CREATE INDEX IF NOT EXISTS ix_invitations_workspace   ON invitations (json_extract(data, '$.workspaceId'));
CREATE INDEX IF NOT EXISTS ix_password_resets_token   ON password_resets (json_extract(data, '$.tokenHash'));
CREATE INDEX IF NOT EXISTS ix_email_verif_token       ON email_verifications (json_extract(data, '$.tokenHash'));
CREATE INDEX IF NOT EXISTS ix_mfa_challenges_token    ON mfa_challenges (json_extract(data, '$.tokenHash'));
CREATE INDEX IF NOT EXISTS ix_oauth_states_hash       ON oauth_states (json_extract(data, '$.stateHash'));

-- tenancy: workspace → projects → columns / tasks / milestones / files
CREATE INDEX IF NOT EXISTS ix_workspaces_owner        ON workspaces (json_extract(data, '$.ownerId'));
CREATE INDEX IF NOT EXISTS ix_projects_workspace      ON projects (json_extract(data, '$.workspaceId'));
CREATE INDEX IF NOT EXISTS ix_columns_project         ON task_columns (json_extract(data, '$.projectId'));
CREATE INDEX IF NOT EXISTS ix_tasks_workspace         ON tasks (json_extract(data, '$.workspaceId'));
CREATE INDEX IF NOT EXISTS ix_tasks_project           ON tasks (json_extract(data, '$.projectId'));
CREATE INDEX IF NOT EXISTS ix_tasks_assignee          ON tasks (json_extract(data, '$.assigneeId'));
CREATE INDEX IF NOT EXISTS ix_milestones_project      ON milestones (json_extract(data, '$.projectId'));
CREATE INDEX IF NOT EXISTS ix_files_project           ON files (json_extract(data, '$.projectId'));
CREATE INDEX IF NOT EXISTS ix_saved_reports_workspace ON saved_reports (json_extract(data, '$.workspaceId'));
CREATE INDEX IF NOT EXISTS ix_templates_workspace     ON project_templates (json_extract(data, '$.workspaceId'));
CREATE INDEX IF NOT EXISTS ix_activity_workspace      ON activity (json_extract(data, '$.workspaceId'), json_extract(data, '$.createdAt'));

-- automation & integrations
CREATE INDEX IF NOT EXISTS ix_automations_workspace   ON automations (json_extract(data, '$.workspaceId'));
CREATE INDEX IF NOT EXISTS ix_automation_logs_ws      ON automation_logs (json_extract(data, '$.workspaceId'));
CREATE INDEX IF NOT EXISTS ix_webhooks_workspace      ON webhooks (json_extract(data, '$.workspaceId'));
CREATE INDEX IF NOT EXISTS ix_webhook_deliveries_hook ON webhook_deliveries (json_extract(data, '$.webhookId'));
CREATE INDEX IF NOT EXISTS ix_notifications_user      ON notifications (json_extract(data, '$.userId'));
CREATE UNIQUE INDEX IF NOT EXISTS ux_feature_flags_key ON feature_flags (json_extract(data, '$.key'));

-- security & privacy
CREATE INDEX IF NOT EXISTS ix_audit_logs_time         ON audit_logs (json_extract(data, '$.timestamp'));
CREATE INDEX IF NOT EXISTS ix_audit_logs_actor        ON audit_logs (json_extract(data, '$.actorId'));
CREATE INDEX IF NOT EXISTS ix_system_events_time      ON system_events (json_extract(data, '$.createdAt'));
CREATE INDEX IF NOT EXISTS ix_incidents_status        ON security_incidents (json_extract(data, '$.status'));
CREATE INDEX IF NOT EXISTS ix_privacy_requests_user   ON privacy_requests (json_extract(data, '$.userId'));
