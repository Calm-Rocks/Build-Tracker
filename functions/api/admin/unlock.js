async function audit(env, event, data = {}) {
  await env.DB.prepare(
    'INSERT INTO audit_log (event, email, ip, user_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    event,
    data.email || null,
    data.ip || null,
    data.user_id || null,
    data.meta ? JSON.stringify(data.meta) : null,
    Date.now()
  ).run();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return json({ error: 'Unauthorised.' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const { email } = body;
  if (!email) return json({ error: 'Email is required.' }, 400);

  const normalizedEmail = email.toLowerCase().trim();

  const user = await env.DB.prepare(
    'SELECT id, email, locked_until FROM users WHERE email = ?'
  ).bind(normalizedEmail).first();

  if (!user) return json({ error: 'User not found.' }, 404);

  await env.DB.prepare(
    'UPDATE users SET locked_until = NULL WHERE id = ?'
  ).bind(user.id).run();

  // Clear rate limits too
  await env.DB.prepare(
    'DELETE FROM rate_limits WHERE key LIKE ?'
  ).bind(`login%${normalizedEmail}%`).run();

  await audit(env, 'admin_user_unlocked', { email: normalizedEmail, ip, user_id: user.id });

  return json({ ok: true, email: normalizedEmail });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}