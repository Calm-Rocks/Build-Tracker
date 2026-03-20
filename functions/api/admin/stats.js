export async function onRequestGet(context) {
  const { request, env } = context;

  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return json({ error: 'Unauthorised.' }, 401);
  }

  const [users, sessions, invites] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM users').first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM sessions WHERE expires_at > ?').bind(Date.now()).first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM invites WHERE used = 0 AND expires_at > ?').bind(Date.now()).first(),
  ]);

  return json({
    users:           users.count,
    sessions:        sessions.count,
    pending_invites: invites.count,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}