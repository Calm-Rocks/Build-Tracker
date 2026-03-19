export async function onRequestPost(context) {
  const { request, env } = context;

  // Only allow admin (you) to generate invites
  // We check for a secret admin key in the request header
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

  if (!email) {
    return json({ error: 'Email is required.' }, 400);
  }

  // Check not already registered
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(email.toLowerCase().trim()).first();

  if (existing) {
    return json({ error: 'A user with this email already exists.' }, 400);
  }

  // Check no active invite already exists
  const existingInvite = await env.DB.prepare(
    'SELECT token FROM invites WHERE email = ? AND used = 0 AND expires_at > ?'
  ).bind(email.toLowerCase().trim(), Date.now()).first();

  if (existingInvite) {
    return json({ error: 'An active invite already exists for this email.', token: existingInvite.token }, 400);
  }

  // Generate invite token — expires in 7 days
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

  await env.DB.prepare(
    'INSERT INTO invites (token, email, used, expires_at) VALUES (?, ?, 0, ?)'
  ).bind(token, email.toLowerCase().trim(), expiresAt).run();

  const inviteUrl = `${new URL(request.url).origin}/auth/accept-invite?token=${token}`;

  return json({ ok: true, invite_url: inviteUrl, email, expires_at: expiresAt });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}