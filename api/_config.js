// Shared settings. Values come from Vercel > Project > Settings > Environment Variables.
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
export const MODEL_VERSION = process.env.MODEL_VERSION || "Interim engine: Gemini general-purpose model (not the trained OralGuard weights)";
export const API_TOKEN = process.env.API_TOKEN || "";
export const PHOTO_ONLY_CHECK = process.env.PHOTO_ONLY_CHECK === "1";
export const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
