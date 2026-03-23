// functions/api/builds/[id].js
// GET    — fetch single build (owner or client member)
// PUT    — update build, logging activity + bumping sync version
// DELETE — delete build (creator only)

import { logActivity, diffMilestones, diffTasks, A } from '../_activity.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function canAccess(env, build, userId) {
  if (build.user_id === userId) return true;
  if (!build.client_id) return false;
  const m = await env.DB.prepare(
    'SELECT role FROM client_members WHERE client_id = ? AND user_id = ?'
  ).bind(build.client_id, userId).first();
  return !!m;
}

function mapBuild(b) {
  return {
    id:            b.id,
    clientId:      b.client_id,
    parentBuildId: b.parent_build_id,
    title:         b.title,
    type:          b.type,
    status:        b.status,
    desc:          b.description,
    startDate:     b.start_date,
    endDate:       b.end_date,
    demoDate:      b.demo_date,
    notes:         b.notes,
    milestones:    JSON.parse(b.milestones || '[]'),
    tweaks:        JSON.parse(b.tweaks     || '[]'),
    createdAt:     b.created_at,
    createdBy:     b.user_id,
  };
}

export async function onRequestGet(context) {
  const { env, data, params } = context;
  const userId  = data.user.id;
  const buildId = params.id;

  const b = await env.DB.prepare('SELECT * FROM builds WHERE id = ?').bind(buildId).first();
  if (!b || !(await canAccess(env, b, userId))) return json({ error: 'Not found.' }, 404);
  return json(mapBuild(b));
}

export async function onRequestPut(context) {
  const { request, env, data, params } = context;
  const userId    = data.user.id;
  const userEmail = data.user.email;
  const buildId   = params.id;

  const existing = await env.DB.prepare('SELECT * FROM builds WHERE id = ?').bind(buildId).first();
  if (!existing || !(await canAccess(env, existing, userId))) return json({ error: 'Not found.' }, 404);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request body.' }, 400); }

  const {
    title, type, status, clientId, parentBuildId,
    description, startDate, endDate, demoDate,
    notes, milestones, tweaks,
  } = body;

  if (!title) return json({ error: 'Title is required.' }, 400);
  if (title.length > 200) return json({ error: 'Title too long (max 200 characters).' }, 400);
  if (notes       && notes.length       > 10000) return json({ error: 'Notes too long (max 10000 characters).' }, 400);
  if (description && description.length >  2000) return json({ error: 'Description too long (max 2000 characters).' }, 400);

  await env.DB.prepare(`
    UPDATE builds SET
      title = ?, type = ?, status = ?,
      client_id = ?, parent_build_id = ?,
      description = ?, start_date = ?, end_date = ?, demo_date = ?,
      notes = ?, milestones = ?, tweaks = ?
    WHERE id = ?
  `).bind(
    title, type, status,
    clientId || '', parentBuildId || '',
    description || '', startDate || '', endDate || '', demoDate || '',
    notes || '',
    JSON.stringify(milestones || []),
    JSON.stringify(tweaks     || []),
    buildId
  ).run();

  // ── Detect and log specific changes ──────────────────────
  const workspaceId = clientId || '__personal__';
  const base        = { clientId: workspaceId, buildId, userId, userEmail };
  const oldMs       = JSON.parse(existing.milestones || '[]');
  const oldTw       = JSON.parse(existing.tweaks     || '[]');
  const events      = [];

  if (existing.status !== status) {
    events.push({ action: A.BUILD_STATUS_CHANGED, meta: { title, oldStatus: existing.status, newStatus: status } });
  }
  events.push(...diffMilestones(title, oldMs, milestones || []));
  events.push(...diffTasks(title, oldTw, tweaks || []));
  if (events.length === 0) {
    events.push({ action: A.BUILD_UPDATED, meta: { title } });
  }

  // Fire-and-forget — don't delay the response
  Promise.all(events.map(e => logActivity(env, { ...base, action: e.action, meta: e.meta })))
    .catch(err => console.error('Activity log error:', err));

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, data, params } = context;
  const userId    = data.user.id;
  const userEmail = data.user.email;
  const buildId   = params.id;

  const b = await env.DB.prepare('SELECT * FROM builds WHERE id = ?').bind(buildId).first();
  if (!b) return json({ error: 'Not found.' }, 404);
  if (b.user_id !== userId) return json({ error: 'Only the build creator can delete it.' }, 403);

  await env.DB.prepare('DELETE FROM builds WHERE id = ?').bind(buildId).run();

  logActivity(env, {
    clientId: b.client_id || '__personal__',
    buildId,
    userId,
    userEmail,
    action:   A.BUILD_DELETED,
    meta:     { title: b.title },
  }).catch(err => console.error('Activity log error:', err));

  return json({ ok: true });
}
