const COOKIE_NAME = 'bt_session';
const PUBLIC_PATHS = [
  '/auth/login',
  '/auth/accept-invite',
  '/api/auth/login',
  '/api/auth/accept-invite',
  '/api/invite',
];

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Allow public paths through
  if (PUBLIC_PATHS.some(p => path.startsWith(p))) {
    return next();
  }

  // Allow static assets through
  if (path.match(/\.(css|js|png|ico|svg|woff2?)$/)) {
    return next();
  }

  // Check for session cookie
  const cookie = request.headers.get('Cookie') || '';
  const sessionId = parseCookie(cookie, COOKIE_NAME);

  if (!sessionId) {
    return redirectToLogin(url);
  }

  // Validate session in D1
  const session = await env.DB.prepare(
    'SELECT s.id, s.user_id, s.expires_at, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?'
  ).bind(sessionId).first();

  if (!session || session.expires_at < Date.now()) {
    // Clean up expired session
    if (session) {
      await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    }
    return redirectToLogin(url);
  }

  // Attach user to context for use in API routes
  context.data.user = {
    id: session.user_id,
    email: session.email,
  };

  return next();
}

function parseCookie(cookieHeader, name) {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

function redirectToLogin(url) {
  const loginUrl = new URL('/auth/login', url.origin);
  loginUrl.searchParams.set('next', url.pathname);
  return Response.redirect(loginUrl.toString(), 302);
}