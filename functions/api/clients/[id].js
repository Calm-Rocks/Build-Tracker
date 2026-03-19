export async function onRequestPut(context) {
  const { request, env, data, params } = context;
  const userId   = data.user.id;
  const clientId = params.id;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM clients WHERE id = ? AND user_id = ?'
  ).bind(clientId, userId).first();

  if (!existing) return json({ error: 'Not found.' }, 404);

  const { name, color, emoji, notes } = body;

  await env.DB.prepare(`
    UPDATE clients SET name = ?, color = ?, emoji = ?, notes = ?
    WHERE id = ? AND user_id = ?
  `).bind(
    name, color, emoji || '', notes || '',
    clientId, userId
  ).run();

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, data, params } = context;
  const userId   = data.user.id;
  const clientId = params.id;

  const existing = await env.DB.prepare(
    'SELECT id FROM clients WHERE id = ? AND user_id = ?'
  ).bind(clientId, userId).first();

  if (!existing) return json({ error: 'Not found.' }, 404);

  await env.DB.prepare(
    'DELETE FROM clients WHERE id = ? AND user_id = ?'
  ).bind(clientId, userId).run();

  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}