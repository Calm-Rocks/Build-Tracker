export async function onRequestPost(context) {
  const { request, env } = context;

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

    const data = await res.json();

    if (!res.ok) {
      console.error('Anthropic API error:', data);
      return json({ error: 'AI extraction failed.' }, 502);
    }

    const raw   = data.content?.map(i => i.text || '').join('');
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