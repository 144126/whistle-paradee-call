export function onRequestGet({ env }) {
  return Response.json({
    key: Boolean(env.BASETEN_API_KEY),
    providers: { baseten: Boolean(env.BASETEN_API_KEY), groq: Boolean(env.GROQ_API_KEY), openrouter: Boolean(env.WHISTLE_OPENROUTER_KEY) },
    tts: { baseten: Boolean(env.BASETEN_API_KEY && env.BASETEN_TTS_URL), groq: Boolean(env.GROQ_API_KEY) },
  });
}
