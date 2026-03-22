// functions/api/clients/[id]/share.js
//
// POST /api/clients/:id/share
//   Owner generates (or refreshes) a single-use invite link for this client.
//   Returns: { invite_url, token, expires_at }
//
// GET  /api/clients/:id/share
//   Owner lists all pending (unused, non-expired) invites + current members.
//   Returns: { members, pending_invites }
//
// DELETE /api/clients/:id/share/:token  — handled in share/[token].js

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getMembership(env, clientId, userId) {
  return env.DB.prepare(
    'SELECT role FROM client_members WHERE client_id = ? AND user_id = ?'
  ).bind(clientId, userId).first();
}

// GET — list members and pending invites
export async function onRequestGet(context) {
  const { env, data, params } = context;
  const userId   = data.user.id;
  const clientId = params.id;

  const membership = await getMembership(env, clientId, userId);
  if (!membership) return json({ error: 'Not found.' }, 404);
  if (membership.role !== 'owner') return json({ error: 'Only the owner can manage sharing.' }, 403);

  const [membersResult, invitesResult] = await Promise.all([
    env.DB.prepare(`
      SELECT cm.user_id, cm.role, cm.joined_at, u.email
      FROM   client_members cm
      JOIN   users u ON u.id = cm.user_id
      WHERE  cm.client_id = ?
      ORDER  BY cm.joined_at ASC
    `).bind(clientId).all(),

    env.DB.prepare(`
      SELECT token, created_by, expires_at
      FROM   client_share_invites
      WHERE  client_id = ? AND used = 0 AND expires_at > ?
      ORDER  BY expires_at DESC
    `).bind(clientId, Date.now()).all(),
  ]);

  return json({
    members: membersResult.results.map(m => ({
      userId:   m.user_id,
      email:    m.email,
      role:     m.role,
      joinedAt: m.joined_at,
    })),
    pendingInvites: invitesResult.results.map(i => ({
      token:     i.token,
      expiresAt: i.expires_at,
    })),
  });
}

// POST — generate a new invite link
export async function onRequestPost(context) {
  const { request, env, data, params } = context;
  const userId   = data.user.id;
  const clientId = params.id;

  const membership = await getMembership(env, clientId, userId);
  if (!membership) return json({ error: 'Not found.' }, 404);
  if (membership.role !== 'owner') return json({ error: 'Only the owner can invite members.' }, 403);

  // Expire any existing unused invites for this client so there's only ever one active
  await env.DB.prepare(`
    UPDATE client_share_invites SET expires_at = 0
    WHERE  client_id = ? AND used = 0 AND created_by = ?
  `).bind(clientId, userId).run();

  // Create a new invite — 7 day expiry
  const token     = crypto.randomUUID();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

  await env.DB.prepare(`
    INSERT INTO client_share_invites (token, client_id, created_by, expires_at, used)
    VALUES (?, ?, ?, ?, 0)
  `).bind(token, clientId, userId, expiresAt).run();

  const origin     = new URL(request.url).origin;
  const inviteUrl  = `${origin}/auth/accept-client-invite?token=${token}`;

  return json({ ok: true, invite_url: inviteUrl, token, expires_at: expiresAt });
}
