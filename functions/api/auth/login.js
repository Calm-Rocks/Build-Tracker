import { compare } from 'bcryptjs';

const COOKIE_NAME = 'bt_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_ATTEMPTS = 10;
const LOCKOUT_DURATION = 60 * 60 * 1000; // 1 hour

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

  if (now - record.window_start > WINDOW_MS) {
    await env.DB.prepare(
      'UPDATE rate_limits SET attempts = 1, window_start = ? WHERE key = ?'
    ).bind(now, key).run();
    return { limited: false, attempts: 1 };
  }

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
    'SELECT id, email, password_hash, locked_until FROM users WHERE email = ?'
  ).bind(normalizedEmail).first();

  if (!user) {
    await audit(env, 'login_failed_unknown_email', { email: normalizedEmail, ip });
    return json({ error: 'Invalid email or password.' }, 401);
  }

  // Check account lockout
  if (user.locked_until && user.locked_until > Date.now()) {
    const minutesLeft = Math.ceil((user.locked_until - Date.now()) / 60000);
    await audit(env, 'login_account_locked', { email: normalizedEmail, ip, user_id: user.id });
    return json({ error: `Account temporarily locked. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.` }, 423);
  }

  // Reject Google-only accounts
  if (!user.password_hash) {
    await audit(env, 'login_failed_google_only', { email: normalizedEmail, ip });
    return json({ error: 'This account uses Google sign in.' }, 401);
  }

  // Check password
  const valid = await compare(password, user.password_hash);

  if (!valid) {
    // Track failed attempts against the account
    const accountKey = `login_account:${normalizedEmail}`;
    const { attempts } = await checkRateLimit(env, accountKey);

    // Lock account after too many failures
    if (attempts >= LOCKOUT_ATTEMPTS) {
      const lockedUntil = Date.now() + LOCKOUT_DURATION;
      await env.DB.prepare(
        'UPDATE users SET locked_until = ? WHERE id = ?'
      ).bind(lockedUntil, user.id).run();
      await audit(env, 'login_account_locked_triggered', { email: normalizedEmail, ip, user_id: user.id });
      return json({ error: 'Too many failed attempts. Account locked for 1 hour.' }, 423);
    }

    await audit(env, 'login_failed_wrong_password', { email: normalizedEmail, ip, user_id: user.id });
    return json({ error: 'Invalid email or password.' }, 401);
  }

  // Clear rate limits and lockout on successful login
  await Promise.all([
    env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(rateLimitKey).run(),
    env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(`login_account:${normalizedEmail}`).run(),
    env.DB.prepare('UPDATE users SET locked_until = NULL WHERE id = ?').bind(user.id).run(),
  ]);

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