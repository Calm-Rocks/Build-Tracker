export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/google/callback`;

  // Generate a random state token to prevent CSRF in the OAuth flow.
  // We store it in a short-lived cookie and validate it in the callback.
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'online',
    prompt:        'select_account',
    state,
  });

  const stateCookie = [
    `bt_oauth_state=${state}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=300',
    'Path=/',
  ].join('; ');

  return new Response(null, {
    status: 302,
    headers: {
      'Location':   `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      'Set-Cookie': stateCookie,
    },
  });
}
