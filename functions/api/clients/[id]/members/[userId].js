// functions/api/clients/[id]/members/[userId].js
//
// DELETE /api/clients/:id/members/:userId
//   Owner can remove any member (but not themselves).
//   A member can remove themselves (leave the client).

import { logActivity, A } from '../../../_activity.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestDelete(context) {
  const { env, data, params } = context;
  const requestingUserId = data.user.id;
  const userEmail        = data.user.email;
  const clientId         = params.id;
  const targetUserId     = parseInt(params.userId, 10);

  // Get requesting user's membership
  const requesterMembership = await env.DB.prepare(
    'SELECT role FROM client_members WHERE client_id = ? AND user_id = ?'
  ).bind(clientId, requestingUserId).first();

  if (!requesterMembership) return json({ error: 'Not found.' }, 404);

  const isSelf  = requestingUserId === targetUserId;
  const isOwner = requesterMembership.role === 'owner';

  // Only owner can remove others; anyone can remove themselves (leave)
  if (!isSelf && !isOwner) {
    return json({ error: 'Permission denied.' }, 403);
  }

  // Owner cannot remove themselves — they must delete the client instead
  if (isSelf && isOwner) {
    return json({ error: 'Owner cannot leave. Transfer ownership or delete the client.' }, 400);
  }

  // Fetch target user email for activity log before deletion
  const targetUser = await env.DB.prepare(
    'SELECT email FROM users WHERE id = ?'
  ).bind(targetUserId).first();

  await env.DB.prepare(
    'DELETE FROM client_members WHERE client_id = ? AND user_id = ?'
  ).bind(clientId, targetUserId).run();

  // Fetch client name for activity log
  const client = await env.DB.prepare(
    'SELECT name FROM clients WHERE id = ?'
  ).bind(clientId).first();

  logActivity(env, {
    clientId,
    userId:    requestingUserId,
    userEmail,
    action:    A.MEMBER_REMOVED,
    meta:      { email: targetUser?.email || '', clientName: client?.name || '' },
  }).catch(err => console.error('Activity log error:', err));

  return json({ ok: true });
}
