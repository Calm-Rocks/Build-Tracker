const COOKIE_NAME = 'bt_session';
const CSRF_COOKIE = 'bt_csrf';

const PUBLIC_PATHS = [
  '/auth/login',
  '/auth/accept-invite',
  '/api/auth/login',
  '/api/auth/accept-invite',
  '/api/auth/google',
  '/api/auth/google/callback',
  '/api/invite',
];

const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://api.anthropic.com",
    "frame-ancestors 'none'",
  ].join('; '),
};

function addSecurityHeaders(response, csrfToken) {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    newHeaders.set(key, value);
  }
  if (csrfToken) {
    newHeaders.append('Set-Cookie', [
      `${CSRF_COOKIE}=${csrfToken}`,
      'SameSite=Strict',
      'Secure',
      'Path=/',
      'Max-Age=86400',
    ].join('; '));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function generateCsrfToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
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

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Normalise trailing slash
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;

  // Allow public paths through
  if (PUBLIC_PATHS.some(p => normalizedPath.startsWith(p))) {
    const response = await next();
    return addSecurityHeaders(response, null);
  }

  // Allow static assets through
  if (path.match(/\.(css|js|png|ico|svg|woff2?)$/)) {
    const response = await next();
    return addSecurityHeaders(response, null);
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
    if (session) {
      await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    }
    return redirectToLogin(url);
  }

// CSRF check on state-changing requests to API endpoints
  if (method !== 'GET' && normalizedPath.startsWith('/api/')) {
    // Admin endpoints are protected by ADMIN_KEY — exempt from CSRF
    if (!normalizedPath.startsWith('/api/admin/') && normalizedPath !== '/api/invite') {
      const existingCsrf = parseCookie(cookie, CSRF_COOKIE);
      const headerCsrf   = request.headers.get('X-CSRF-Token');

      if (!existingCsrf || !headerCsrf || existingCsrf !== headerCsrf) {
        return new Response(JSON.stringify({ error: 'Invalid CSRF token.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  // Attach user to context
  context.data.user = {
    id: session.user_id,
    email: session.email,
  };

  // Refresh CSRF token on each authenticated page load
  const csrfToken = normalizedPath.startsWith('/api/')
    ? null
    : generateCsrfToken();

  const response = await next();
  return addSecurityHeaders(response, csrfToken);
}