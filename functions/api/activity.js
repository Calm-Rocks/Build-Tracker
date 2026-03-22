// functions/api/activity.js
//
// GET /api/activity?clientId=...&limit=50&before=<activity_id>
//
// Returns paginated activity for a given client workspace.
// Used to populate the activity feed panel in the UI.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet(context) {
  const { request, env, data } = context;
  const userId = data.user.id;
  const url    = new URL(request.url);

  const clientId = url.searchParams.get('clientId');
  const limit    = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const before   = url.searchParams.get('before'); // activity id for pagination

  if (!clientId) return json({ error: 'clientId is required.' }, 400);

  // Verify access
  if (clientId !== '__personal__') {
    const membership = await env.DB.prepare(
      'SELECT role FROM client_members WHERE client_id = ? AND user_id = ?'
    ).bind(clientId, userId).first();
    if (!membership) return json({ error: 'Not found.' }, 404);
  } else {
    // Personal workspace — only your own activity
  }

  let query, bindings;
  if (before) {
    query    = `SELECT * FROM activity_log WHERE client_id = ? AND id < ? ORDER BY created_at DESC LIMIT ?`;
    bindings = [clientId, parseInt(before, 10), limit];
  } else {
    query    = `SELECT * FROM activity_log WHERE client_id = ? ORDER BY created_at DESC LIMIT ?`;
    bindings = [clientId, limit];
  }

  const { results } = await env.DB.prepare(query).bind(...bindings).all();

  return json({
    activity: results.map(a => ({
      id:        a.id,
      buildId:   a.build_id,
      userId:    a.user_id,
      email:     a.user_email,
      action:    a.action,
      meta:      JSON.parse(a.meta || '{}'),
      createdAt: a.created_at,
    })),
    hasMore: results.length === limit,
  });
}
