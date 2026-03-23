// functions/api/builds.js
// GET  — all builds the user can see (own + shared client memberships)
// POST — create a new build, logs activity

import { logActivity, A } from './_activity.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
  const { env, data } = context;
  const userId = data.user.id;

  const { results } = await env.DB.prepare(`
    SELECT DISTINCT b.*
    FROM   builds b
    LEFT   JOIN client_members cm ON cm.client_id = b.client_id AND cm.user_id = ?
    WHERE  b.user_id = ?
       OR  cm.user_id = ?
    ORDER  BY b.created_at DESC
  `).bind(userId, userId, userId).all();

  return json({ builds: results.map(mapBuild), userId });  // userId so frontend can seed currentUserId
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const userId    = data.user.id;
  const userEmail = data.user.email;

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request body.' }, 400); }

  const {
    id, title, type, status, clientId, parentBuildId,
    description, startDate, endDate, demoDate,
    notes, milestones, tweaks, createdAt,
  } = body;

  if (!id || !title || !type || !status) {
    return json({ error: 'Missing required fields.' }, 400);
  }

  if (title.length > 200) return json({ error: 'Title too long (max 200 characters).' }, 400);
  if (notes    && notes.length       > 10000) return json({ error: 'Notes too long (max 10000 characters).' }, 400);
  if (description && description.length > 2000) return json({ error: 'Description too long (max 2000 characters).' }, 400);

  if (clientId) {
    const membership = await env.DB.prepare(
      'SELECT role FROM client_members WHERE client_id = ? AND user_id = ?'
    ).bind(clientId, userId).first();
    if (!membership) return json({ error: 'You are not a member of that client.' }, 403);
  }

  await env.DB.prepare(`
    INSERT INTO builds (
      id, user_id, client_id, parent_build_id, title, type, status,
      description, start_date, end_date, demo_date,
      notes, milestones, tweaks, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId, clientId || '', parentBuildId || '',
    title, type, status,
    description || '', startDate || '', endDate || '', demoDate || '',
    notes || '',
    JSON.stringify(milestones || []),
    JSON.stringify(tweaks     || []),
    createdAt || Date.now()
  ).run();

  logActivity(env, {
    clientId:  clientId || '__personal__',
    buildId:   id,
    userId,
    userEmail,
    action:    A.BUILD_CREATED,
    meta:      { title },
  }).catch(err => console.error('Activity log error:', err));

  return json({ ok: true, id });
}
