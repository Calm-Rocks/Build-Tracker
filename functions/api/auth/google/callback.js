const COOKIE_NAME = 'bt_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
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
    return Response.redirect(`${url.origin}/auth/login?error=google_failed`, 302);
  }

  if (!tokens.access_token) {
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
    return Response.redirect(`${url.origin}/auth/login?error=google_failed`, 302);
  }

  if (!googleUser.id || !googleUser.email) {
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
    } else {
      const invite = await env.DB.prepare(
        'SELECT token FROM invites WHERE email = ? AND used = 0 AND expires_at > ?'
      ).bind(googleUser.email.toLowerCase(), Date.now()).first();

      if (!invite) {
        return Response.redirect(`${url.origin}/auth/login?error=no_invite`, 302);
      }

      const result = await env.DB.prepare(
        'INSERT INTO users (email, password_hash, google_id, created_at) VALUES (?, ?, ?, ?)'
      ).bind(googleUser.email.toLowerCase(), '', googleUser.id, Date.now()).run();

      await env.DB.prepare(
        'UPDATE invites SET used = 1 WHERE token = ?'
      ).bind(invite.token).run();

      user = { id: result.meta.last_row_id, email: googleUser.email };
    }
  }

  // Create session
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_DURATION;

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionId, user.id, expiresAt).run();

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