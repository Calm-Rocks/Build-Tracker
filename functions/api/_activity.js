// functions/api/_activity.js
// Shared helpers for writing activity log entries and bumping sync version.
// Imported by builds/[id].js, builds.js, clients.js, clients/[id].js

// ── ACTION CONSTANTS ────────────────────────────────────────
export const A = {
  // Build actions
  BUILD_CREATED:          'build.created',
  BUILD_UPDATED:          'build.updated',
  BUILD_STATUS_CHANGED:   'build.status_changed',
  BUILD_DELETED:          'build.deleted',
  MILESTONE_COMPLETED:    'milestone.completed',
  MILESTONE_UNCOMPLETED:  'milestone.uncompleted',
  MILESTONE_ADDED:        'milestone.added',
  MILESTONE_REMOVED:      'milestone.removed',
  TASK_COMPLETED:         'task.completed',
  TASK_UNCOMPLETED:       'task.uncompleted',
  TASK_ADDED:             'task.added',
  // Client actions
  CLIENT_CREATED:         'client.created',
  CLIENT_UPDATED:         'client.updated',
  MEMBER_JOINED:          'member.joined',
  MEMBER_REMOVED:         'member.removed',
};

// Human-readable labels for the UI feed
export const ACTION_LABELS = {
  [A.BUILD_CREATED]:         (m) => `created build <strong>${m.title}</strong>`,
  [A.BUILD_UPDATED]:         (m) => `updated <strong>${m.title}</strong>`,
  [A.BUILD_STATUS_CHANGED]:  (m) => `moved <strong>${m.title}</strong> to <em>${m.newStatus}</em>`,
  [A.BUILD_DELETED]:         (m) => `deleted build <strong>${m.title}</strong>`,
  [A.MILESTONE_COMPLETED]:   (m) => `completed milestone <em>${m.milestone}</em> on <strong>${m.title}</strong>`,
  [A.MILESTONE_UNCOMPLETED]: (m) => `reopened milestone <em>${m.milestone}</em> on <strong>${m.title}</strong>`,
  [A.MILESTONE_ADDED]:       (m) => `added milestone <em>${m.milestone}</em> to <strong>${m.title}</strong>`,
  [A.MILESTONE_REMOVED]:     (m) => `removed milestone <em>${m.milestone}</em> from <strong>${m.title}</strong>`,
  [A.TASK_COMPLETED]:        (m) => `completed task <em>${m.task}</em> on <strong>${m.title}</strong>`,
  [A.TASK_UNCOMPLETED]:      (m) => `reopened task <em>${m.task}</em> on <strong>${m.title}</strong>`,
  [A.TASK_ADDED]:            (m) => `added task <em>${m.task}</em> to <strong>${m.title}</strong>`,
  [A.CLIENT_CREATED]:        (m) => `created client <strong>${m.name}</strong>`,
  [A.CLIENT_UPDATED]:        (m) => `updated client <strong>${m.name}</strong>`,
  [A.MEMBER_JOINED]:         (m) => `joined <strong>${m.clientName}</strong>`,
  [A.MEMBER_REMOVED]:        (m) => `removed <strong>${m.email}</strong> from <strong>${m.clientName}</strong>`,
};

// ── HELPERS ─────────────────────────────────────────────────

/**
 * Write an activity entry and bump the sync version for the workspace.
 *
 * @param {object} env        - Cloudflare env (DB binding)
 * @param {object} opts
 * @param {string} opts.clientId   - client.id or '__personal__'
 * @param {string} [opts.buildId]  - build.id if build-level event
 * @param {number} opts.userId
 * @param {string} opts.userEmail
 * @param {string} opts.action     - one of A.*
 * @param {object} [opts.meta]     - extra context for the label renderer
 */
export async function logActivity(env, opts) {
  const { clientId, buildId, userId, userEmail, action, meta = {} } = opts;
  const now = Date.now();

  await Promise.all([
    // Write activity entry
    env.DB.prepare(`
      INSERT INTO activity_log (client_id, build_id, user_id, user_email, action, meta, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      clientId,
      buildId  || null,
      userId,
      userEmail,
      action,
      JSON.stringify(meta),
      now
    ).run(),

    // Upsert sync_state version — bump by 1
    env.DB.prepare(`
      INSERT INTO sync_state (client_id, version, updated_at) VALUES (?, 1, ?)
      ON CONFLICT (client_id) DO UPDATE SET version = version + 1, updated_at = ?
    `).bind(clientId, now, now).run(),
  ]);
}

/**
 * Diff old and new milestones/tweaks arrays and return activity entries.
 * Returns an array of { action, meta } objects to be logged.
 */
export function diffMilestones(buildTitle, oldMs, newMs) {
  const events = [];
  const oldMap = Object.fromEntries((oldMs || []).map(m => [m.id, m]));
  const newMap = Object.fromEntries((newMs || []).map(m => [m.id, m]));

  for (const [id, nm] of Object.entries(newMap)) {
    const om = oldMap[id];
    if (!om) {
      events.push({ action: A.MILESTONE_ADDED,   meta: { title: buildTitle, milestone: nm.label } });
    } else if (!om.done && nm.done) {
      events.push({ action: A.MILESTONE_COMPLETED,   meta: { title: buildTitle, milestone: nm.label } });
    } else if (om.done && !nm.done) {
      events.push({ action: A.MILESTONE_UNCOMPLETED, meta: { title: buildTitle, milestone: nm.label } });
    }
  }
  for (const [id, om] of Object.entries(oldMap)) {
    if (!newMap[id]) {
      events.push({ action: A.MILESTONE_REMOVED, meta: { title: buildTitle, milestone: om.label } });
    }
  }
  return events;
}

export function diffTasks(buildTitle, oldTw, newTw) {
  const events = [];
  const oldMap = Object.fromEntries((oldTw || []).map((t, i) => [t.text + i, t]));
  const newMap = Object.fromEntries((newTw || []).map((t, i) => [t.text + i, t]));

  for (const [key, nt] of Object.entries(newMap)) {
    const ot = oldMap[key];
    if (!ot) {
      events.push({ action: A.TASK_ADDED, meta: { title: buildTitle, task: nt.text } });
    } else if (!ot.done && nt.done) {
      events.push({ action: A.TASK_COMPLETED,   meta: { title: buildTitle, task: nt.text } });
    } else if (ot.done && !nt.done) {
      events.push({ action: A.TASK_UNCOMPLETED, meta: { title: buildTitle, task: nt.text } });
    }
  }
  return events;
}
