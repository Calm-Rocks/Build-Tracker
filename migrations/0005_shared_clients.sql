-- ============================================================
-- 0005_shared_clients.sql
-- Shared client collaboration feature
--
-- Design:
--   - clients gains an `owner_id` (same as user_id today, kept for
--     backwards compat) and a nullable `shared_token` used to generate
--     invite links.
--   - `client_members` is the join table: one row per (client, user).
--     role = 'owner' | 'member'
--   - builds / clients queries join through client_members so both
--     owner and members see the same data.
--   - client_share_invites holds pending invite tokens (7-day expiry,
--     single-use). On accept the user is inserted into client_members.
-- ============================================================

-- 1. Track which user originally created the client.
--    For existing rows owner_id = user_id (same value).
ALTER TABLE clients ADD COLUMN owner_id INTEGER;
UPDATE clients SET owner_id = user_id;

-- 2. Membership join table
CREATE TABLE client_members (
  client_id  TEXT    NOT NULL,
  user_id    INTEGER NOT NULL,
  role       TEXT    NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (client_id, user_id)
);

-- Seed: every existing client gets its owner as the first member
INSERT INTO client_members (client_id, user_id, role, joined_at)
SELECT id, user_id, 'owner', created_at FROM clients;

-- 3. Pending share invites (for a specific client, sent by owner)
CREATE TABLE client_share_invites (
  token      TEXT    PRIMARY KEY,
  client_id  TEXT    NOT NULL,
  created_by INTEGER NOT NULL,   -- user_id of sender
  expires_at INTEGER NOT NULL,
  used       INTEGER DEFAULT 0
);

-- Index for fast token lookups
CREATE INDEX idx_csi_token ON client_share_invites (token);

-- Index to speed up membership checks
CREATE INDEX idx_cm_user   ON client_members (user_id);
CREATE INDEX idx_cm_client ON client_members (client_id);
