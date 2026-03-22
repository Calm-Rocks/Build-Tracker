-- ============================================================
-- 0006_activity_and_sync.sql
-- Activity feed + sync polling support
--
-- activity_log: one row per user action on a build or client.
--   Used to render the activity feed in the UI.
--
-- sync_cursors: each client gets a monotonically increasing
--   `version` integer. When any build/client in a shared workspace
--   changes, its version is bumped. Collaborators poll
--   GET /api/sync?since=<version> and only receive the delta.
-- ============================================================

-- Activity feed
CREATE TABLE activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   TEXT    NOT NULL,
  build_id    TEXT,                  -- NULL for client-level events
  user_id     INTEGER NOT NULL,
  user_email  TEXT    NOT NULL,
  action      TEXT    NOT NULL,      -- see action constants in sync.js
  meta        TEXT    DEFAULT '{}',  -- JSON: title, field changed, old/new value etc
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_al_client    ON activity_log (client_id, created_at DESC);
CREATE INDEX idx_al_build     ON activity_log (build_id,  created_at DESC);
CREATE INDEX idx_al_created   ON activity_log (created_at DESC);

-- Per-workspace version counter for efficient polling
-- One row per shared client (and one row for unshared / personal workspace)
CREATE TABLE sync_state (
  client_id   TEXT    PRIMARY KEY,   -- client.id or '__personal__' for unshared builds
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL
);
