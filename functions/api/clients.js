export async function onRequestGet(context) {
  const { env, data } = context;
  const userId = data.user.id;

  const { results } = await env.DB.prepare(
    'SELECT * FROM clients WHERE user_id = ? ORDER BY created_at ASC'
  ).bind(userId).all();

  const clients = results.map(c => ({
    id:        c.id,
    name:      c.name,
    color:     c.color,
    emoji:     c.emoji,
    notes:     c.notes,
    createdAt: c.created_at,
  }));

  return json({ clients });
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const userId = data.user.id;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const { id, name, color, emoji, notes, createdAt } = body;

  if (!id || !name || !color) {
    return json({ error: 'Missing required fields.' }, 400);
  }

  await env.DB.prepare(`
    INSERT INTO clients (id, user_id, name, color, emoji, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId, name, color,
    emoji || '', notes || '',
    createdAt || Date.now()
  ).run();

  return json({ ok: true, id });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}