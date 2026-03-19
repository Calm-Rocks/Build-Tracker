export async function onRequestGet(context) {
  const { env, data } = context;
  const userId = data.user.id;

  const { results } = await env.DB.prepare(
    'SELECT * FROM builds WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();

  // Parse JSON blobs back to arrays
  const builds = results.map(b => ({
    ...b,
    milestones: JSON.parse(b.milestones || '[]'),
    tweaks:     JSON.parse(b.tweaks     || '[]'),
  }));

  return json({ builds });
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

  const {
    id, title, type, status, clientId, parentBuildId,
    description, startDate, endDate, demoDate,
    notes, milestones, tweaks, createdAt,
  } = body;

  if (!id || !title || !type || !status) {
    return json({ error: 'Missing required fields.' }, 400);
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

  return json({ ok: true, id });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}