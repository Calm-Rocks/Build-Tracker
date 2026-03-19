const COOKIE_NAME = 'bt_session';

export async function onRequestPost(context) {
  const { request, env } = context;

  const cookie = request.headers.get('Cookie') || '';
  const sessionId = parseCookie(cookie, COOKIE_NAME);

  if (sessionId) {
    await env.DB.prepare(
      'DELETE FROM sessions WHERE id = ?'
    ).bind(sessionId).run();
  }

  const expiredCookie = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Max-Age=0',
    'Path=/',
  ].join('; ');

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': expiredCookie,
    },
  });
}

function parseCookie(cookieHeader, name) {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}