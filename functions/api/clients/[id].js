// functions/api/clients/[id].js
// PUT    — update client (owner only), log activity
// DELETE — delete client (owner only)

import { logActivity, A } from '../_activity.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getMembership(env, clientId, userId) {
  return env.DB.prepare(
    'SELECT role FROM client_members WHERE client_id = ? AND user_id = ?'
  ).bind(clientId, userId).first();
}

export async function onRequestPut(context) {
  const { request, env, data, params } = context;
  const userId    = data.user.id;
  const userEmail = data.user.email;
  const clientId  = params.id;

  const membership = await getMembership(env, clientId, userId);
  if (!membership) return json({ error: 'Not found.' }, 404);
  if (membership.role !== 'owner') return json({ error: 'Only the owner can edit this client.' }, 403);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request body.' }, 400); }

  const { name, color, emoji, notes } = body;

  await env.DB.prepare(`
    UPDATE clients SET name = ?, color = ?, emoji = ?, notes = ?
    WHERE id = ?
  `).bind(name, color, emoji || '', notes || '', clientId).run();

  logActivity(env, {
    clientId,
    userId,
    userEmail,
    action: A.CLIENT_UPDATED,
    meta:   { name },
  }).catch(err => console.error('Activity log error:', err));

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, data, params } = context;
  const userId   = data.user.id;
  const clientId = params.id;

  const membership = await getMembership(env, clientId, userId);
  if (!membership) return json({ error: 'Not found.' }, 404);
  if (membership.role !== 'owner') return json({ error: 'Only the owner can delete this client.' }, 403);

  await Promise.all([
    env.DB.prepare('DELETE FROM client_members WHERE client_id = ?').bind(clientId).run(),
    env.DB.prepare('DELETE FROM client_share_invites WHERE client_id = ?').bind(clientId).run(),
    env.DB.prepare('DELETE FROM activity_log WHERE client_id = ?').bind(clientId).run(),
    env.DB.prepare('DELETE FROM sync_state WHERE client_id = ?').bind(clientId).run(),
    env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(clientId).run(),
  ]);

  return json({ ok: true });
}
