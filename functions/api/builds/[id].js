export async function onRequestGet(context) {
  const { env, data, params } = context;
  const userId  = data.user.id;
  const buildId = params.id;

  const b = await env.DB.prepare(
    'SELECT * FROM builds WHERE id = ? AND user_id = ?'
  ).bind(buildId, userId).first();

  if (!b) return json({ error: 'Not found.' }, 404);

  return json({
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
  });
}

export async function onRequestPut(context) {
  const { request, env, data, params } = context;
  const userId  = data.user.id;
  const buildId = params.id;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM builds WHERE id = ? AND user_id = ?'
  ).bind(buildId, userId).first();

  if (!existing) return json({ error: 'Not found.' }, 404);

  const {
    title, type, status, clientId, parentBuildId,
    description, startDate, endDate, demoDate,
    notes, milestones, tweaks,
  } = body;

  await env.DB.prepare(`
    UPDATE builds SET
      title = ?, type = ?, status = ?,
      client_id = ?, parent_build_id = ?,
      description = ?, start_date = ?, end_date = ?, demo_date = ?,
      notes = ?, milestones = ?, tweaks = ?
    WHERE id = ? AND user_id = ?
  `).bind(
    title, type, status,
    clientId || '', parentBuildId || '',
    description || '', startDate || '', endDate || '', demoDate || '',
    notes || '',
    JSON.stringify(milestones || []),
    JSON.stringify(tweaks     || []),
    buildId, userId
  ).run();

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, data, params } = context;
  const userId  = data.user.id;
  const buildId = params.id;

  const existing = await env.DB.prepare(
    'SELECT id FROM builds WHERE id = ? AND user_id = ?'
  ).bind(buildId, userId).first();

  if (!existing) return json({ error: 'Not found.' }, 404);

  await env.DB.prepare(
    'DELETE FROM builds WHERE id = ? AND user_id = ?'
  ).bind(buildId, userId).run();

  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}