import { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODEL, MODEL_VERSION, HEALTH_TOKEN, json } from "./_config.js";

// Public: only "ok" and the engine label (the app's Test connection needs these).
// Full details (which models are set, whether the key is present) only with
// /api/health?token=<HEALTH_TOKEN>, where HEALTH_TOKEN is a Vercel environment variable.
export function GET(request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  const ready = !!GEMINI_API_KEY;
  if (HEALTH_TOKEN && token === HEALTH_TOKEN) {
    return json({ status: ready ? "ok" : "missing GEMINI_API_KEY", model_version: MODEL_VERSION, model: GEMINI_MODEL, fallback_model: GEMINI_FALLBACK_MODEL });
  }
  return json({ status: ready ? "ok" : "unavailable", model_version: MODEL_VERSION });
}
