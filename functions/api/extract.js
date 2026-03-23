const RATE_LIMIT_MAX    = 20;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

async function checkRateLimit(env, userId) {
  const key = `extract:${userId}`;
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

  if (now - record.window_start > RATE_LIMIT_WINDOW) {
    await env.DB.prepare(
      'UPDATE rate_limits SET attempts = 1, window_start = ? WHERE key = ?'
    ).bind(now, key).run();
    return { limited: false };
  }

  const attempts = record.attempts + 1;
  await env.DB.prepare(
    'UPDATE rate_limits SET attempts = ? WHERE key = ?'
  ).bind(attempts, key).run();

  return { limited: attempts > RATE_LIMIT_MAX };
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const userId = data.user.id;

  const { limited } = await checkRateLimit(env, userId);
  if (limited) {
    return json({ error: 'Too many extraction requests. Please try again later.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const { text } = body;

  if (!text || typeof text !== 'string') {
    return json({ error: 'Text is required.' }, 400);
  }

  if (text.length > 8000) {
    return json({ error: 'Text too long.' }, 400);
  }

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'API key not configured.' }, 500);
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            env.ANTHROPIC_API_KEY,
        'anthropic-version':    '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system:     'You are a project management assistant. Extract all action items, tasks, builds, tweaks, or follow-up items from the text. Return ONLY a JSON array, no markdown. Each item: {"title":"short 3-8 word title","desc":"one sentence","type":"build or tweak"}',
        messages:   [{ role: 'user', content: `Extract:\n\n${text.slice(0, 4000)}` }],
      }),
    });

    const apiData = await res.json();

    if (!res.ok) {
      console.error('Anthropic API error:', apiData);
      return json({ error: 'AI extraction failed.' }, 502);
    }

    const raw   = apiData.content?.map(i => i.text || '').join('');
    const items = JSON.parse(raw.replace(/```json|```/g, '').trim());

    return json({ ok: true, items });

  } catch (err) {
    console.error('Extract error:', err);
    return json({ error: 'Extraction failed.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
