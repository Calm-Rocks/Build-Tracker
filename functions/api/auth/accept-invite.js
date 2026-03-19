import { hash } from 'bcryptjs';

export async function onRequestPost(context) {
  const { request, env } = context;

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

  if (password.length < 8) {
    return json({ error: 'Password must be at least 8 characters.' }, 400);
  }

  // Look up invite
  const invite = await env.DB.prepare(
    'SELECT token, email, used, expires_at FROM invites WHERE token = ?'
  ).bind(token).first();

  if (!invite) {
    return json({ error: 'Invalid invite link.' }, 400);
  }

  if (invite.used) {
    return json({ error: 'This invite has already been used.' }, 400);
  }

  if (invite.expires_at < Date.now()) {
    return json({ error: 'This invite has expired.' }, 400);
  }

  // Check email not already registered
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(invite.email.toLowerCase()).first();

  if (existing) {
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

  return json({ ok: true, email: invite.email });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}