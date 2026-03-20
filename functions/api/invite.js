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
    await audit(env, 'invite_unauthorised', { ip });
    return json({ error: 'Unauthorised.' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const { email } = body;

  if (!email) {
    return json({ error: 'Email is required.' }, 400);
  }

  const normalizedEmail = email.toLowerCase().trim();

  if (normalizedEmail.length > 254) {
    return json({ error: 'Invalid email address.' }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return json({ error: 'Invalid email address.' }, 400);
  }

  // Check not already registered
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(normalizedEmail).first();

  if (existing) {
    await audit(env, 'invite_failed_user_exists', { email: normalizedEmail, ip });
    return json({ error: 'A user with this email already exists.' }, 400);
  }

  // Reuse active invite if one exists
  const existingInvite = await env.DB.prepare(
    'SELECT token FROM invites WHERE email = ? AND used = 0 AND expires_at > ?'
  ).bind(normalizedEmail, Date.now()).first();

  if (existingInvite) {
    const inviteUrl = `${new URL(request.url).origin}/auth/accept-invite?token=${existingInvite.token}`;
    await audit(env, 'invite_reused', { email: normalizedEmail, ip });
    return json({ ok: true, invite_url: inviteUrl, email: normalizedEmail, reused: true });
  }

  // Generate new invite token — expires in 7 days
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

  await env.DB.prepare(
    'INSERT INTO invites (token, email, used, expires_at) VALUES (?, ?, 0, ?)'
  ).bind(token, normalizedEmail, expiresAt).run();

  await audit(env, 'invite_created', { email: normalizedEmail, ip });

  const inviteUrl = `${new URL(request.url).origin}/auth/accept-invite?token=${token}`;

  return json({ ok: true, invite_url: inviteUrl, email: normalizedEmail, expires_at: expiresAt });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}