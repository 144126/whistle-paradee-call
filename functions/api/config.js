export function onRequestGet({ env }) {
  return Response.json({ key: Boolean(env.BASETEN_API_KEY) });
}
