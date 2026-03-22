# Shared Client Feature — Full Package

Includes three interconnected features:

1. **Shared clients** — invite teammates to collaborate on a client folder
2. **Real-time sync** — 15-second polling keeps all collaborators up to date  
3. **Activity feed** — per-client log of every change, visible to all members

---

## File map

```
migrations/
  0005_shared_clients.sql          ← Run first
  0006_activity_and_sync.sql       ← Run second

functions/api/
  _activity.js                     ← NEW (shared helper, imported by others)
  builds.js                        ← REPLACE
  builds/[id].js                   ← REPLACE
  clients.js                       ← REPLACE
  clients/[id].js                  ← REPLACE
  clients/[id]/share.js            ← NEW
  clients/[id]/members/[userId].js ← NEW
  auth/accept-client-invite.js     ← NEW
  activity.js                      ← NEW
  sync.js                          ← NEW
  sync/versions.js                 ← NEW

auth/
  accept-client-invite/index.html  ← NEW

build-tracker-sharing.js           ← Append to build-tracker.js
build-tracker-sync.js              ← Append to build-tracker.js

FRONTEND_SNIPPETS.html             ← Share modal HTML + CSS + renderFolders diff
ACTIVITY_AND_SYNC_SNIPPETS.html    ← Activity panel HTML + CSS + init() diff
```

---

## Step 1 — Run migrations

```bash
wrangler d1 execute build-tracker-db --file=migrations/0005_shared_clients.sql
wrangler d1 execute build-tracker-db --file=migrations/0006_activity_and_sync.sql
```

Both are safe on a live database — no destructive changes, existing data is preserved.

---

## Step 2 — Deploy API files

Copy all files from `functions/` into your repo, replacing existing ones where indicated.
New route files are picked up automatically by Cloudflare Pages.

Copy `auth/accept-client-invite/index.html` into your `auth/` folder.

No `_middleware.js` changes needed — unauthenticated users hitting the invite page
are redirected to login and returned automatically.

---

## Step 3 — Frontend

**3a** — Append `build-tracker-sharing.js` to `build-tracker.js` (before `init()`)

**3b** — Append `build-tracker-sync.js` to `build-tracker.js` (after sharing code, before `init()`)

**3c** — Copy the share modal HTML from `FRONTEND_SNIPPETS.html` into `index.html`
before `<script src="build-tracker.js"></script>`

**3d** — Copy the activity panel + sync indicator from `ACTIVITY_AND_SYNC_SNIPPETS.html`
into `index.html`. Add the sync indicator span inside `.topbar-left`.

**3e** — Append CSS blocks from both snippet files to `build-tracker.css`

**3f** — Replace `renderFolders()` return block with the version in
`ACTIVITY_AND_SYNC_SNIPPETS.html` (adds share/activity buttons per folder)

**3g** — Replace `init()` and `loadData()` with versions from `ACTIVITY_AND_SYNC_SNIPPETS.html`
(seeds `currentUserId`, starts sync polling on startup)

---

## How sync works

Every write operation calls `logActivity()` which bumps a version counter in `sync_state`.
The frontend polls `/api/sync` every 15 seconds, sending its last-known version per workspace.
The server returns only workspaces that have changed, with full updated builds + recent activity.
The frontend merges the delta and re-renders silently — no page reload needed.

WebSockets would give true real-time but require Cloudflare Durable Objects (paid).
15-second polling is a good tradeoff for the free tier.

---

## How the activity feed works

`builds/[id].js` diffs old vs new milestones and tasks on every PUT, generating
specific events like "completed milestone QA raised on Portal Redesign" rather
than just "updated build". The feed is grouped by day, shows avatar initials,
and labels your own actions as "You".

---

## Access control

| Action                | Who              |
|-----------------------|------------------|
| View builds           | Owner + members  |
| Create / edit builds  | Owner + members  |
| Delete a build        | Creator only     |
| Edit client metadata  | Owner only       |
| Delete client         | Owner only       |
| Generate invite link  | Owner only       |
| View activity feed    | Owner + members  |
| Remove a member       | Owner (any) / Member (self only) |
