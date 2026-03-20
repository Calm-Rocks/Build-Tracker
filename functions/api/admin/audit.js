export async function onRequestGet(context) {
  const { request, env } = context;

  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return json({ error: 'Unauthorised.' }, 401);
  }

  const { results } = await env.DB.prepare(
    'SELECT event, email, ip, user_id, meta, created_at FROM audit_log ORDER BY created_at DESC LIMIT 50'
  ).all();

  return json({ entries: results });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

So the new file structure in `functions/api/admin/` is:
```
functions/api/admin/
├── audit.js
├── cleanup.js
└── stats.js