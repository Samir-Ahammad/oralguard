// Shared settings. Values come from Vercel > Project > Settings > Environment Variables.
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
// Main model. The Vercel environment variable GEMINI_MODEL always wins; this default is used only if it is missing.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
// Backup model: used as soon as the main model fails (e.g. 503 overloaded). Set the exact code from AI Studio "Get code".
export const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.6-flash";
export const MODEL_VERSION = process.env.MODEL_VERSION || "Inference engine: OralGuard Trained model v1.0.0";
export const API_TOKEN = process.env.API_TOKEN || "";
// Secret word for the full /api/health details: open /api/health?token=YOUR_WORD
export const HEALTH_TOKEN = process.env.HEALTH_TOKEN || "";
export const PHOTO_ONLY_CHECK = process.env.PHOTO_ONLY_CHECK === "1";
export const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
