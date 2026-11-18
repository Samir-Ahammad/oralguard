import { GEMINI_API_KEY, GEMINI_MODEL, MODEL_VERSION, json } from "./_config.js";
export function GET() {
  return json({ status: GEMINI_API_KEY ? "ok" : "missing GEMINI_API_KEY", model_version: MODEL_VERSION, model: GEMINI_MODEL });
}
