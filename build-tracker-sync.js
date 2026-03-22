// ============================================================
// build-tracker-sync.js
// Real-time sync polling + activity feed
// Append this to build-tracker.js (before the init() call)
// ============================================================

// ── ACTION LABEL RENDERERS (mirrors _activity.js) ────────────
const ACTION_LABELS = {
  'build.created':         m => `created <strong>${esc(m.title)}</strong>`,
  'build.updated':         m => `updated <strong>${esc(m.title)}</strong>`,
  'build.status_changed':  m => `moved <strong>${esc(m.title)}</strong> → <em>${esc(m.newStatus)}</em>`,
  'build.deleted':         m => `deleted build <strong>${esc(m.title)}</strong>`,
  'milestone.completed':   m => `completed milestone <em>${esc(m.milestone)}</em> on <strong>${esc(m.title)}</strong>`,
  'milestone.uncompleted': m => `reopened milestone <em>${esc(m.milestone)}</em> on <strong>${esc(m.title)}</strong>`,
  'milestone.added':       m => `added milestone <em>${esc(m.milestone)}</em> to <strong>${esc(m.title)}</strong>`,
  'milestone.removed':     m => `removed milestone <em>${esc(m.milestone)}</em> from <strong>${esc(m.title)}</strong>`,
  'task.completed':        m => `completed task <em>${esc(m.task)}</em> on <strong>${esc(m.title)}</strong>`,
  'task.uncompleted':      m => `reopened task <em>${esc(m.task)}</em> on <strong>${esc(m.title)}</strong>`,
  'task.added':            m => `added task <em>${esc(m.task)}</em> to <strong>${esc(m.title)}</strong>`,
  'client.created':        m => `created client <strong>${esc(m.name)}</strong>`,
  'client.updated':        m => `updated client <strong>${esc(m.name)}</strong>`,
  'member.joined':         m => `joined <strong>${esc(m.clientName)}</strong>`,
  'member.removed':        m => `removed <strong>${esc(m.email)}</strong>`,
};

function renderActivityLabel(action, meta) {
  const fn = ACTION_LABELS[action];
  return fn ? fn(meta) : action;
}

// ── SYNC STATE ────────────────────────────────────────────────
// clientId -> version number (last known)
const syncVersions = {};
let syncTimer      = null;
const SYNC_INTERVAL_MS = 15000; // poll every 15 seconds

function startSync() {
  if (syncTimer) return;
  syncTimer = setInterval(pollSync, SYNC_INTERVAL_MS);
}

function stopSync() {
  clearInterval(syncTimer);
  syncTimer = null;
}

function getSyncableClientIds() {
  // Include all client IDs we know about, plus __personal__ for unshared builds
  return ['__personal__', ...clients.map(c => c.id)];
}

async function pollSync() {
  const ids = getSyncableClientIds();
  if (!ids.length) return;

  const versionsParam = ids.map(id => syncVersions[id] ?? 0).join(',');
  const clientsParam  = ids.join(',');

  try {
    const res  = await apiFetch(`/api/sync?clients=${encodeURIComponent(clientsParam)}&versions=${encodeURIComponent(versionsParam)}`);
    if (!res.ok) return;

    const data = await res.json();
    if (!data.changed || data.changed.length === 0) return;

    let needsRender = false;
    let needsActivityRefresh = false;

    for (const workspace of data.changed) {
      // Update version
      syncVersions[workspace.clientId] = workspace.version;

      // Merge builds — replace any builds belonging to this workspace
      if (workspace.clientId === '__personal__') {
        // Remove existing personal builds, add new ones
        builds = [
          ...builds.filter(b => b.clientId && b.clientId !== ''),
          ...workspace.builds,
        ];
      } else {
        builds = [
          ...builds.filter(b => b.clientId !== workspace.clientId),
          ...workspace.builds,
        ];
      }

      // Update activity cache
      if (workspace.activity && workspace.activity.length) {
        activityCache[workspace.clientId] = workspace.activity;
        needsActivityRefresh = true;
      }

      needsRender = true;
    }

    if (needsRender) {
      updateStats();
      renderFolders();

      // Re-render the current view if relevant
      if (currentView === 'daily') {
        renderDaily();
      } else if (currentView !== 'daily' && !currentBuildId) {
        renderBoard();
      }

      // Show a subtle toast indicating data was refreshed
      showSyncIndicator(data.changed.length);
    }

    if (needsActivityRefresh && activityPanelOpen) {
      renderActivityFeed();
    }

  } catch (err) {
    console.warn('Sync poll failed:', err);
  }
}

function showSyncIndicator(changedCount) {
  // Show a small non-intrusive indicator, not a full toast
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  el.textContent = 'Synced just now';
  el.style.opacity = '1';
  clearTimeout(el._fadeTimer);
  el._fadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

// Seed initial versions after first loadData()
// Call this at the end of init() in build-tracker.js:
//   seedSyncVersions();
//   startSync();
async function seedSyncVersions() {
  const ids = getSyncableClientIds();
  if (!ids.length) return;
  try {
    const placeholders = ids.map(() => '?').join(',');
    // We can't query D1 directly from frontend — instead, do a sync poll
    // with version 0 for everything to get the current versions without
    // triggering false "changed" deltas.
    const res  = await apiFetch(`/api/sync?clients=${encodeURIComponent(ids.join(','))}&versions=${ids.map(() => '999999999').join(',')}`);
    // version 999999999 = "I'm already up to date" so we get no changed data,
    // but this lets us... actually we need a different approach.
    // Instead, just fetch versions directly:
    const vRes = await apiFetch(`/api/sync/versions?clients=${encodeURIComponent(ids.join(','))}`);
    if (vRes.ok) {
      const vData = await vRes.json();
      for (const [cid, ver] of Object.entries(vData.versions || {})) {
        syncVersions[cid] = ver;
      }
    }
  } catch {
    // Non-fatal — sync will work correctly on next poll
  }
}

// ── SYNC VERSIONS ENDPOINT HELPER ─────────────────────────────
// Add this simple endpoint to functions/api/sync/versions.js
// (see sync-versions.js file)


// ── ACTIVITY FEED ─────────────────────────────────────────────
const activityCache = {};   // clientId -> activity[]
let activityPanelOpen    = false;
let activityClientId     = null;
let activityLoading      = false;

function openActivityPanel(clientId) {
  activityClientId  = clientId;
  activityPanelOpen = true;
  document.getElementById('activity-panel').classList.add('open');
  const c = clients.find(x => x.id === clientId);
  document.getElementById('ap-client-name').textContent = c ? c.name : 'Activity';
  document.getElementById('ap-list').innerHTML =
    '<div class="ap-loading"><span class="spinner"></span> Loading…</div>';
  fetchActivity(clientId, false);
}

function closeActivityPanel() {
  activityPanelOpen = false;
  activityClientId  = null;
  document.getElementById('activity-panel').classList.remove('open');
}

async function fetchActivity(clientId, append) {
  if (activityLoading) return;
  activityLoading = true;

  const cached = activityCache[clientId];
  const before = append && cached && cached.length ? cached[cached.length - 1].id : null;

  try {
    const url = `/api/activity?clientId=${encodeURIComponent(clientId)}&limit=30${before ? '&before=' + before : ''}`;
    const res  = await apiFetch(url);
    if (!res.ok) { renderActivityError(); return; }

    const data = await res.json();
    const entries = data.activity || [];

    if (append) {
      activityCache[clientId] = [...(activityCache[clientId] || []), ...entries];
    } else {
      activityCache[clientId] = entries;
    }

    renderActivityFeed(data.hasMore);
  } catch {
    renderActivityError();
  } finally {
    activityLoading = false;
  }
}

function renderActivityFeed(hasMore) {
  const list    = document.getElementById('ap-list');
  const entries = activityCache[activityClientId] || [];

  if (!entries.length) {
    list.innerHTML = '<div class="ap-empty">No activity yet.</div>';
    return;
  }

  // Group by day
  const groups = {};
  entries.forEach(a => {
    const d   = new Date(a.createdAt);
    const key = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  });

  list.innerHTML = Object.entries(groups).map(([day, items]) => `
    <div class="ap-day-group">
      <div class="ap-day-label">${day}</div>
      ${items.map(a => {
        const label   = renderActivityLabel(a.action, a.meta);
        const time    = new Date(a.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const initial = (a.email || '?')[0].toUpperCase();
        const isSelf  = a.userId === currentUserId;
        return `<div class="ap-entry${isSelf ? ' ap-self' : ''}">
          <div class="ap-avatar">${initial}</div>
          <div class="ap-body">
            <span class="ap-actor">${isSelf ? 'You' : esc(a.email.split('@')[0])}</span>
            <span class="ap-action"> ${label}</span>
          </div>
          <div class="ap-time">${time}</div>
        </div>`;
      }).join('')}
    </div>
  `).join('');

  // Load more button
  if (hasMore) {
    list.insertAdjacentHTML('beforeend', `
      <button class="btn btn-sm" style="width:100%;margin-top:10px;"
        onclick="fetchActivity('${activityClientId}', true)">Load more</button>
    `);
  }
}

function renderActivityError() {
  document.getElementById('ap-list').innerHTML =
    '<div class="ap-empty" style="color:var(--danger-text);">Failed to load activity.</div>';
}

// Expose current user ID so the feed can label "You" vs others
// Set this in init() after loadData(): currentUserId = data.user.id
// (you'll need to return user.id from /api/builds or a /api/me endpoint)
let currentUserId = null;
