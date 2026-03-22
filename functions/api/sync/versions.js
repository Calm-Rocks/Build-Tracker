// functions/api/sync/versions.js
//
// GET /api/sync/versions?clients=id1,id2,...
//
// Returns the current sync version for each requested workspace.
// Used on startup to seed the frontend's known versions so the
// first poll doesn't incorrectly treat everything as changed.

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

  const clientIdsParam = url.searchParams.get('clients') || '';
  const clientIds      = clientIdsParam.split(',').filter(Boolean).slice(0, 50);

  if (!clientIds.length) return json({ versions: {} });

  // Security: filter to only clients the user is a member of
  // (plus __personal__ which is always accessible)
  const accessibleIds = ['__personal__'];
  await Promise.all(
    clientIds.filter(id => id !== '__personal__').map(async cid => {
      const m = await env.DB.prepare(
        'SELECT role FROM client_members WHERE client_id = ? AND user_id = ?'
      ).bind(cid, userId).first();
      if (m) accessibleIds.push(cid);
    })
  );

  if (!accessibleIds.length) return json({ versions: {} });

  const placeholders = accessibleIds.map(() => '?').join(',');
  const { results }  = await env.DB.prepare(
    `SELECT client_id, version FROM sync_state WHERE client_id IN (${placeholders})`
  ).bind(...accessibleIds).all();

  const versions = {};
  results.forEach(r => { versions[r.client_id] = r.version; });

  // Fill in 0 for any that don't have a sync_state row yet
  accessibleIds.forEach(id => { if (!(id in versions)) versions[id] = 0; });

  return json({ versions });
}
