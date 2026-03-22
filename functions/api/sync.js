// functions/api/sync.js
//
// GET /api/sync?clients=id1,id2,id3&versions=v1,v2,v3
//
// Lightweight polling endpoint. The frontend sends the client IDs it cares
// about and the last-known version for each. The server returns only the
// workspaces that have changed, with their full updated builds + new activity.
//
// Response:
// {
//   changed: [
//     {
//       clientId: "...",
//       version:  42,
//       builds:   [...],        // full updated builds for this workspace
//       activity: [...]         // last 20 activity entries for this workspace
//     }
//   ],
//   serverTime: 1234567890
// }
//
// The frontend merges changed workspaces into its local state and re-renders.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mapBuild(b) {
  return {
    id:            b.id,
    clientId:      b.client_id,
    parentBuildId: b.parent_build_id,
    title:         b.title,
    type:          b.type,
    status:        b.status,
    desc:          b.description,
    startDate:     b.start_date,
    endDate:       b.end_date,
    demoDate:      b.demo_date,
    notes:         b.notes,
    milestones:    JSON.parse(b.milestones || '[]'),
    tweaks:        JSON.parse(b.tweaks     || '[]'),
    createdAt:     b.created_at,
    createdBy:     b.user_id,
  };
}

function mapActivity(a) {
  return {
    id:        a.id,
    buildId:   a.build_id,
    userId:    a.user_id,
    email:     a.user_email,
    action:    a.action,
    meta:      JSON.parse(a.meta || '{}'),
    createdAt: a.created_at,
  };
}

export async function onRequestGet(context) {
  const { request, env, data } = context;
  const userId = data.user.id;
  const url    = new URL(request.url);

  const clientIdsParam  = url.searchParams.get('clients')  || '';
  const versionsParam   = url.searchParams.get('versions') || '';

  if (!clientIdsParam) return json({ changed: [], serverTime: Date.now() });

  const clientIds = clientIdsParam.split(',').filter(Boolean).slice(0, 50); // cap at 50
  const versions  = versionsParam.split(',').map(v => parseInt(v, 10) || 0);

  // Build a map of clientId -> knownVersion
  const knownVersions = {};
  clientIds.forEach((id, i) => { knownVersions[id] = versions[i] ?? 0; });

  // Verify user is a member of all requested clients (security check)
  const membershipChecks = await Promise.all(
    clientIds.map(cid =>
      env.DB.prepare(
        'SELECT role FROM client_members WHERE client_id = ? AND user_id = ?'
      ).bind(cid, userId).first()
    )
  );

  // Only process clients the user actually has access to
  const accessibleClientIds = clientIds.filter((_, i) => !!membershipChecks[i]);
  // Also include __personal__ for unshared builds
  const allIds = [...accessibleClientIds, '__personal__'];

  // Fetch current versions for all workspaces
  const placeholders = allIds.map(() => '?').join(',');
  const { results: syncRows } = await env.DB.prepare(
    `SELECT client_id, version FROM sync_state WHERE client_id IN (${placeholders})`
  ).bind(...allIds).all();

  const currentVersions = Object.fromEntries(syncRows.map(r => [r.client_id, r.version]));

  // Determine which workspaces have changed
  const changedIds = allIds.filter(cid => {
    const current = currentVersions[cid] ?? 0;
    const known   = knownVersions[cid]   ?? 0;
    return current > known;
  });

  if (changedIds.length === 0) {
    return json({ changed: [], serverTime: Date.now() });
  }

  // For each changed workspace, fetch updated builds + recent activity
  const changed = await Promise.all(changedIds.map(async cid => {
    const isPersonal = cid === '__personal__';

    // Fetch builds for this workspace
    let buildsResult;
    if (isPersonal) {
      buildsResult = await env.DB.prepare(
        `SELECT * FROM builds WHERE user_id = ? AND (client_id = '' OR client_id IS NULL) ORDER BY created_at DESC`
      ).bind(userId).all();
    } else {
      buildsResult = await env.DB.prepare(
        `SELECT * FROM builds WHERE client_id = ? ORDER BY created_at DESC`
      ).bind(cid).all();
    }

    // Fetch last 30 activity entries
    const activityResult = await env.DB.prepare(
      `SELECT * FROM activity_log WHERE client_id = ? ORDER BY created_at DESC LIMIT 30`
    ).bind(cid).all();

    return {
      clientId: cid,
      version:  currentVersions[cid] ?? 0,
      builds:   buildsResult.results.map(mapBuild),
      activity: activityResult.results.map(mapActivity),
    };
  }));

  return json({ changed, serverTime: Date.now() });
}
