const COOKIE_NAME = 'bt_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;

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

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    await audit(env, 'google_auth_denied', { ip });
    return Response.redirect(`${url.origin}/auth/login?error=google_failed`, 302);
  }

  const redirectUri = `${url.origin}/api/auth/google/callback`;

  // Exchange code for tokens
  let tokens;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    });
    tokens = await res.json();
  } catch {
    await audit(env, 'google_token_exchange_failed', { ip });
    return Response.redirect(`${url.origin}/auth/login?error=google_failed`, 302);
  }

  if (!tokens.access_token) {
    await audit(env, 'google_token_exchange_failed', { ip, meta: { error: tokens.error } });
    return Response.redirect(`${url.origin}/auth/login?error=google_failed`, 302);
  }

  // Get user info from Google
  let googleUser;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    googleUser = await res.json();
  } catch {
    await audit(env, 'google_userinfo_failed', { ip });
    return Response.redirect(`${url.origin}/auth/login?error=google_failed`, 302);
  }

  if (!googleUser.id || !googleUser.email) {
    await audit(env, 'google_userinfo_invalid', { ip });
    return Response.redirect(`${url.origin}/auth/login?error=google_failed`, 302);
  }

  // Find or create user
  let user = await env.DB.prepare(
    'SELECT id, email FROM users WHERE google_id = ?'
  ).bind(googleUser.id).first();

  if (!user) {
    const existing = await env.DB.prepare(
      'SELECT id, email FROM users WHERE email = ?'
    ).bind(googleUser.email.toLowerCase()).first();

    if (existing) {
      await env.DB.prepare(
        'UPDATE users SET google_id = ? WHERE id = ?'
      ).bind(googleUser.id, existing.id).run();
      user = existing;
      await audit(env, 'google_account_linked', { email: googleUser.email, ip, user_id: existing.id });
    } else {
      const invite = await env.DB.prepare(
        'SELECT token FROM invites WHERE email = ? AND used = 0 AND expires_at > ?'
      ).bind(googleUser.email.toLowerCase(), Date.now()).first();

      if (!invite) {
        await audit(env, 'google_login_no_invite', { email: googleUser.email, ip });
        return Response.redirect(`${url.origin}/auth/login?error=no_invite`, 302);
      }

      const result = await env.DB.prepare(
        'INSERT INTO users (email, password_hash, google_id, created_at) VALUES (?, ?, ?, ?)'
      ).bind(googleUser.email.toLowerCase(), '', googleUser.id, Date.now()).run();

      await env.DB.prepare(
        'UPDATE invites SET used = 1 WHERE token = ?'
      ).bind(invite.token).run();

      user = { id: result.meta.last_row_id, email: googleUser.email };
      await audit(env, 'user_created_google', { email: googleUser.email, ip, user_id: user.id });
    }
  }

  // Create session
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_DURATION;

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionId, user.id, expiresAt).run();

  await audit(env, 'login_success_google', { email: user.email, ip, user_id: user.id });

  const cookie = [
    `${COOKIE_NAME}=${sessionId}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_DURATION / 1000}`,
    'Path=/',
  ].join('; ');

  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/',
      'Set-Cookie': cookie,
    },
  });
}