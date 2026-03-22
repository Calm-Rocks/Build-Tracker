// functions/api/clients/[id]/members/[userId].js
//
// DELETE /api/clients/:id/members/:userId
//   Owner can remove any member (but not themselves).
//   A member can remove themselves (leave the client).

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestDelete(context) {
  const { env, data, params } = context;
  const requestingUserId = data.user.id;
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

  await env.DB.prepare(
    'DELETE FROM client_members WHERE client_id = ? AND user_id = ?'
  ).bind(clientId, targetUserId).run();

  return json({ ok: true });
}
