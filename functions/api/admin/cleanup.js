export async function onRequestPost(context) {
  const { request, env } = context;

  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return json({ error: 'Unauthorised.' }, 401);
  }

  const now = Date.now();

  // Delete expired sessions
  const sessions = await env.DB.prepare(
    'DELETE FROM sessions WHERE expires_at < ?'
  ).bind(now).run();

  // Delete used or expired invites older than 30 days
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const invites = await env.DB.prepare(
    'DELETE FROM invites WHERE (used = 1 OR expires_at < ?) AND expires_at < ?'
  ).bind(now, thirtyDaysAgo).run();

  // Delete rate limit records older than 1 hour
  const oneHourAgo = now - 60 * 60 * 1000;
  await env.DB.prepare(
    'DELETE FROM rate_limits WHERE window_start < ?'
  ).bind(oneHourAgo).run();

  // Delete audit log entries older than 90 days
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
  await env.DB.prepare(
    'DELETE FROM audit_log WHERE created_at < ?'
  ).bind(ninetyDaysAgo).run();

  return json({
    ok: true,
    cleaned: {
      sessions: sessions.meta.changes,
      invites: invites.meta.changes,
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}