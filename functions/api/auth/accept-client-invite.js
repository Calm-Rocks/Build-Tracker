// functions/api/auth/accept-client-invite.js
//
// POST /api/auth/accept-client-invite
//   Body: { token }
//
//   The user must already be authenticated (session required).
//   Validates the token, adds the user to client_members, marks token used.
//   Returns: { ok, clientId, clientName }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function audit(env, event, data = {}) {
  await env.DB.prepare(
    'INSERT INTO audit_log (event, email, ip, user_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    event,
    data.email || null,
    data.ip    || null,
    data.user_id || null,
    data.meta ? JSON.stringify(data.meta) : null,
    Date.now()
  ).run();
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const userId = data.user.id;
  const email  = data.user.email;
  const ip     = request.headers.get('CF-Connecting-IP') || 'unknown';

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const { token } = body;
  if (!token) return json({ error: 'Token is required.' }, 400);

  // Look up the invite
  const invite = await env.DB.prepare(`
    SELECT csi.*, c.name AS client_name
    FROM   client_share_invites csi
    JOIN   clients c ON c.id = csi.client_id
    WHERE  csi.token = ?
  `).bind(token).first();

  if (!invite) {
    await audit(env, 'client_invite_invalid_token', { user_id: userId, email, ip });
    return json({ error: 'Invalid or expired invite link.' }, 400);
  }

  if (invite.used) {
    return json({ error: 'This invite link has already been used.' }, 400);
  }

  if (invite.expires_at < Date.now()) {
    return json({ error: 'This invite link has expired. Ask the owner to generate a new one.' }, 400);
  }

  // Check if user is already a member
  const existing = await env.DB.prepare(
    'SELECT role FROM client_members WHERE client_id = ? AND user_id = ?'
  ).bind(invite.client_id, userId).first();

  if (existing) {
    // Already a member — just redirect them, no error
    return json({ ok: true, clientId: invite.client_id, clientName: invite.client_name, alreadyMember: true });
  }

  // Add to client_members
  await env.DB.prepare(`
    INSERT INTO client_members (client_id, user_id, role, joined_at)
    VALUES (?, ?, 'member', ?)
  `).bind(invite.client_id, userId, Date.now()).run();

  // Mark invite as used
  await env.DB.prepare(
    'UPDATE client_share_invites SET used = 1 WHERE token = ?'
  ).bind(token).run();

  await audit(env, 'client_invite_accepted', {
    user_id: userId,
    email,
    ip,
    meta: { clientId: invite.client_id, clientName: invite.client_name },
  });

  return json({ ok: true, clientId: invite.client_id, clientName: invite.client_name });
}
