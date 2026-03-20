export async function onRequestGet(context) {
  return new Response('callback hit', { status: 200 });
}