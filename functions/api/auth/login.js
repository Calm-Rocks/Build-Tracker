import { compare } from 'bcryptjs';

const COOKIE_NAME = 'bt_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const { email, password } = body;

  if (!email || !password) {
    return json({ error: 'Email and password are required.' }, 400);
  }

  // Look up user
  const user = await env.DB.prepare(
    'SELECT id, email, password_hash FROM users WHERE email = ?'
  ).bind(email.toLowerCase().trim()).first();

  if (!user) {
    return json({ error: 'Invalid email or password.' }, 401);
  }

  // Check password
  const valid = await compare(password, user.password_hash);
  if (!valid) {
    return json({ error: 'Invalid email or password.' }, 401);
  }

  // Create session
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_DURATION;

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionId, user.id, expiresAt).run();

  // Set session cookie
  const cookie = [
    `${COOKIE_NAME}=${sessionId}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${SESSION_DURATION / 1000}`,
    'Path=/',
  ].join('; ');

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
    },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}