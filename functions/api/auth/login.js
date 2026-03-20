import { compare } from 'bcryptjs';

const COOKIE_NAME = 'bt_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

async function checkRateLimit(env, key) {
  const now = Date.now();
  const record = await env.DB.prepare(
    'SELECT attempts, window_start FROM rate_limits WHERE key = ?'
  ).bind(key).first();

  if (!record) {
    await env.DB.prepare(
      'INSERT INTO rate_limits (key, attempts, window_start) VALUES (?, 1, ?)'
    ).bind(key, now).run();
    return { limited: false, attempts: 1 };
  }

  // Reset window if expired
  if (now - record.window_start > WINDOW_MS) {
    await env.DB.prepare(
      'UPDATE rate_limits SET attempts = 1, window_start = ? WHERE key = ?'
    ).bind(now, key).run();
    return { limited: false, attempts: 1 };
  }

  // Increment attempts
  const attempts = record.attempts + 1;
  await env.DB.prepare(
    'UPDATE rate_limits SET attempts = ? WHERE key = ?'
  ).bind(attempts, key).run();

  return { limited: attempts > MAX_ATTEMPTS, attempts };
}

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

  // Enforce input length limits
  if (email.length > 254 || password.length > 1024) {
    return json({ error: 'Invalid input.' }, 400);
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Rate limit by IP and email combined
  const rateLimitKey = `login:${ip}:${normalizedEmail}`;
  const { limited } = await checkRateLimit(env, rateLimitKey);

  if (limited) {
    await audit(env, 'login_rate_limited', { email: normalizedEmail, ip });
    return json({ error: 'Too many login attempts. Please try again in 15 minutes.' }, 429);
  }

  // Look up user
  const user = await env.DB.prepare(
    'SELECT id, email, password_hash FROM users WHERE email = ?'
  ).bind(normalizedEmail).first();

  if (!user) {
    await audit(env, 'login_failed_unknown_email', { email: normalizedEmail, ip });
    return json({ error: 'Invalid email or password.' }, 401);
  }

  // Reject Google-only accounts attempting password login
  if (!user.password_hash) {
    await audit(env, 'login_failed_google_only', { email: normalizedEmail, ip });
    return json({ error: 'This account uses Google sign in.' }, 401);
  }

  // Check password
  const valid = await compare(password, user.password_hash);
  if (!valid) {
    await audit(env, 'login_failed_wrong_password', { email: normalizedEmail, ip, user_id: user.id });
    return json({ error: 'Invalid email or password.' }, 401);
  }

  // Clear rate limit on successful login
  await env.DB.prepare(
    'DELETE FROM rate_limits WHERE key = ?'
  ).bind(rateLimitKey).run();

  // Create session
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_DURATION;

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionId, user.id, expiresAt).run();

  await audit(env, 'login_success', { email: normalizedEmail, ip, user_id: user.id });

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