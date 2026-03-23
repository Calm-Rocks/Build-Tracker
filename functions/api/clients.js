// functions/api/clients.js
// GET  — all clients the user is a member of
// POST — create client, auto-add as owner member, log activity

import { logActivity, A } from './_activity.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet(context) {
  const { env, data } = context;
  const userId = data.user.id;

  const { results } = await env.DB.prepare(`
    SELECT c.*, cm.role
    FROM   clients c
    JOIN   client_members cm ON cm.client_id = c.id
    WHERE  cm.user_id = ?
    ORDER  BY c.created_at ASC
  `).bind(userId).all();

  return json({
    clients: results.map(c => ({
      id:        c.id,
      name:      c.name,
      color:     c.color,
      emoji:     c.emoji,
      notes:     c.notes,
      createdAt: c.created_at,
      ownerId:   c.owner_id,
      role:      c.role,
    })),
  });
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const userId    = data.user.id;
  const userEmail = data.user.email;

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request body.' }, 400); }

  const { id, name, color, emoji, notes, createdAt } = body;
  if (!id || !name || !color) return json({ error: 'Missing required fields.' }, 400);

  if (name.length  > 100)  return json({ error: 'Name too long (max 100 characters).' }, 400);
  if (color.length > 20)   return json({ error: 'Color value too long.' }, 400);
  if (emoji && emoji.length > 10)   return json({ error: 'Emoji value too long.' }, 400);
  if (notes && notes.length > 5000) return json({ error: 'Notes too long (max 5000 characters).' }, 400);

  const now = createdAt || Date.now();

  await env.DB.prepare(`
    INSERT INTO clients (id, user_id, owner_id, name, color, emoji, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, userId, userId, name, color, emoji || '', notes || '', now).run();

  await env.DB.prepare(`
    INSERT INTO client_members (client_id, user_id, role, joined_at)
    VALUES (?, ?, 'owner', ?)
  `).bind(id, userId, now).run();

  logActivity(env, {
    clientId:  id,
    userId,
    userEmail,
    action:    A.CLIENT_CREATED,
    meta:      { name },
  }).catch(err => console.error('Activity log error:', err));

  return json({ ok: true, id });
}
