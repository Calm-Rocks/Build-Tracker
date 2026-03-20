import { hash } from 'bcryptjs';

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkRateLimit(env, key) {
  const now = Date.now();
  const record = await env.DB.prepare(
    'SELECT attempts, window_start FROM rate_limits WHERE key = ?'
  ).bind(key).first();

  if (!record) {
    await env.DB.prepare(
      'INSERT INTO rate_limits (key, attempts, window_start) VALUES (?, 1, ?)'
    ).bind(key, now).run();
    return { limited: false };
  }

  if (now - record.window_start > WINDOW_MS) {
    await env.DB.prepare(
      'UPDATE rate_limits SET attempts = 1, window_start = ? WHERE key = ?'
    ).bind(now, key).run();
    return { limited: false };
  }

  const attempts = record.attempts + 1;
  await env.DB.prepare(
    'UPDATE rate_limits SET attempts = ? WHERE key = ?'
  ).bind(attempts, key).run();

  return { limited: attempts > MAX_ATTEMPTS };
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

  const { token, password } = body;

  if (!token || !password) {
    return json({ error: 'Token and password are required.' }, 400);
  }

  // Input length limits
  if (token.length > 100 || password.length > 1024) {
    return json({ error: 'Invalid input.' }, 400);
  }

  if (password.length < 8) {
    return json({ error: 'Password must be at least 8 characters.' }, 400);
  }

  // Password strength check
  if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return json({ error: 'Password must contain at least one uppercase letter and one number.' }, 400);
  }

  // Rate limit by IP
  const { limited } = await checkRateLimit(env, `accept-invite:${ip}`);
  if (limited) {
    await audit(env, 'accept_invite_rate_limited', { ip });
    return json({ error: 'Too many attempts. Please try again later.' }, 429);
  }

  // Look up invite
  const invite = await env.DB.prepare(
    'SELECT token, email, used, expires_at FROM invites WHERE token = ?'
  ).bind(token).first();

  if (!invite) {
    await audit(env, 'accept_invite_invalid_token', { ip });
    return json({ error: 'Invalid invite link.' }, 400);
  }

  if (invite.used) {
    await audit(env, 'accept_invite_already_used', { email: invite.email, ip });
    return json({ error: 'This invite has already been used.' }, 400);
  }

  if (invite.expires_at < Date.now()) {
    await audit(env, 'accept_invite_expired', { email: invite.email, ip });
    return json({ error: 'This invite has expired.' }, 400);
  }

  // Check email not already registered
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(invite.email.toLowerCase()).first();

  if (existing) {
    await audit(env, 'accept_invite_email_exists', { email: invite.email, ip });
    return json({ error: 'An account with this email already exists.' }, 400);
  }

  // Hash password and create user
  const passwordHash = await hash(password, 12);

  const result = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)'
  ).bind(invite.email.toLowerCase(), passwordHash, Date.now()).run();

  // Mark invite as used
  await env.DB.prepare(
    'UPDATE invites SET used = 1 WHERE token = ?'
  ).bind(token).run();

  await audit(env, 'user_created', { email: invite.email, ip, user_id: result.meta.last_row_id });

  return json({ ok: true, email: invite.email });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}