/*
 * OralGuard interim model service as a Vercel serverless function.
 * Same contract as model-server/server.py, so the web app does not change
 * when the trained weights replace it.
 *   POST /api/predict  multipart: image (JPEG), metadata (JSON), roi (JSON), history (JSON)
 * Uses the Gemini API (general-purpose model, NOT the validated OralGuard model).
 * The key stays on the server: set GEMINI_API_KEY in Vercel environment variables.
 */
import { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODEL, MODEL_VERSION, API_TOKEN, PHOTO_ONLY_CHECK, json } from "./_config.js";

const CLASSES = ["Healthy", "Benign", "OPMD", "OCA"];

// Message shown in the app when the photo does not show any part of the mouth. Edit the text here.
const NOT_ORAL_MESSAGE = "Not an image that can be diagnosed. Please provide a proper image of the mouth.";

const PROMPT = (context, roi) => `You are assisting a trained oral-health screener. Assess ONE white-light intraoral photograph
for oral cancer screening. This is a screening aid, not a diagnosis.

Patient context (may be incomplete; "Unknown" means not recorded):
${context}

Classify the visible oral mucosa into four classes and give probabilities that sum to 1:
- Healthy: normal mucosa or normal anatomical variation
- Benign: benign lesion (e.g. traumatic ulcer, frictional keratosis, fibroma, aphthous ulcer, candidiasis, mucocele)
- OPMD: oral potentially malignant disorder (e.g. leukoplakia, erythroplakia, erythroleukoplakia, oral submucous fibrosis, oral lichen planus)
- OCA: suspected oral cancer (e.g. squamous cell carcinoma: indurated ulcer, exophytic or verrucous growth)

Rules:
- Judge mainly from the image. Use the history only to adjust borderline cases, as an experienced clinician would.
- FIRST decide "oral_visible": true only if some part of the mouth is clearly visible (lips, oral mucosa, tongue, gums, teeth, palate, floor of mouth). If none is visible (e.g. a face from a distance, another body part, an object, a document, a screenshot, an animal), set "oral_visible": false and leave the other fields empty.
- If the mouth is visible but the photo is too blurred or dark to assess, set image_quality "poor" and keep probabilities uncertain.
- The clinician may have outlined regions of concern (0..1 coordinates): ${roi}
- "suspicion" = probability that the lesion needs specialist referral (OPMD or OCA).
- Give regions you looked at as box_2d [ymin, xmin, ymax, xmax] on a 0-1000 scale.

Return ONLY JSON with this shape:
{"oral_visible": true, "intraoral": true, "image_quality": "good|fair|poor",
 "probs": {"Healthy": 0.0, "Benign": 0.0, "OPMD": 0.0, "OCA": 0.0},
 "suspicion": 0.0,
 "lesion_type": "most probable specific lesion name, or 'No lesion seen'",
 "lesion_confidence": 0.0,
 "differential": ["up to 3 alternatives"],
 "findings": "one or two sentences describing what is visible (site, colour, texture, borders)",
 "regions": [{"box_2d": [0,0,0,0], "label": "short label"}]}`;

function contextText(meta, hist, withHistory) {
  if (!withHistory) return "No history provided. Judge from the image alone.";
  const yn = (v) => (v === 1 ? "Yes" : v === 0 ? "No" : v ?? "Unknown");
  const lines = [
    `Age: ${meta.age ?? "Unknown"}`, `Sex: ${meta.sex || "Unknown"}`,
    `Smoking (incl. shisha, dokha/midwakh): ${yn(meta.smoking)}`,
    `Alcohol: ${yn(meta.alcohol)}`,
    `Chewing habit (betel quid, areca, gutka, naswar, smokeless tobacco): ${yn(meta.chewing)}`,
  ];
  const extra = [["tobacco_types", "Tobacco types"], ["chewing_types", "Chewing products"], ["family_history", "Family history of head and neck cancer"],
    ["previous_opmd", "Previous OPMD"], ["inherited_risk", "Inherited high-risk condition"], ["last_exam", "Last oral exam"],
    ["photo_site", "Photographed site"], ["red_flags", "Red flags recorded"]];
  for (const [k, label] of extra) {
    const v = hist[k];
    if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)) lines.push(`${label}: ${Array.isArray(v) ? v.join(", ") : v}`);
  }
  return lines.join("\n");
}

// One call to one model. Throws [status, message, retryable].
async function callModel(model, b64, mime, prompt, timeoutMs) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { temperature: 0.1, response_mime_type: "application/json" },
      }),
    });
  } catch (e) { throw [504, "The Gemini API did not answer in time", true]; }
  finally { clearTimeout(t); }
  if (r.status === 503 || r.status === 500 || r.status === 502) throw [503, `Gemini model '${model}' is overloaded or unavailable (${r.status})`, true];
  if (r.status === 429) throw [429, "Gemini rate limit or daily quota reached. Wait a minute, or try again after the daily reset.", true];
  if (r.status === 404) throw [502, `Gemini model '${model}' not found. Check GEMINI_MODEL against the code name in AI Studio.`, true];
  if (!r.ok) throw [502, `Gemini error ${r.status}: ${(await r.text()).slice(0, 300)}`, false];
  try {
    const j = await r.json();
    let text = j.candidates[0].content.parts.map((p) => p.text || "").join("").trim();
    text = text.replace(/^```(json)?/, "").replace(/```$/, "").trim();
    return JSON.parse(text);
  } catch (e) { throw [502, "Gemini returned an unreadable answer", true]; }
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Tries the main model, then the backup model.
// Stays inside the 60-second function limit.
async function askGemini(b64, mime, prompt) {
  const start = Date.now(), budget = 52000;
  // Main model once; if it fails, go straight to the backup model (with one retry),
  // then one last try on the main model.
  const hasBackup = GEMINI_FALLBACK_MODEL && GEMINI_FALLBACK_MODEL !== GEMINI_MODEL;
  const plan = hasBackup
    ? [[GEMINI_MODEL, 0], [GEMINI_FALLBACK_MODEL, 0], [GEMINI_FALLBACK_MODEL, 1500], [GEMINI_MODEL, 1500]]
    : [[GEMINI_MODEL, 0], [GEMINI_MODEL, 1500], [GEMINI_MODEL, 3000]];
  let last = [503, "Gemini is unavailable", true];
  for (const [model, wait] of plan) {
    if (wait) await sleep(wait);
    const left = budget - (Date.now() - start);
    if (left < 6000) break;
    try {
      const out = await callModel(model, b64, mime, prompt, Math.min(25000, left));
      out.__model = model;
      return out;
    } catch (e) {
      last = Array.isArray(e) ? e : [502, String(e), true];
      console.log(`[oralguard] ${model}: ${last[1]}`);
      if (!last[2]) break;
      if (last[0] === 404) continue; // wrong main model name: go straight on to the fallback
    }
  }
  throw [last[0], last[1] + ". Tried " + (GEMINI_FALLBACK_MODEL ? "the main and fallback models" : "the main model") + " several times."];
}

function normProbs(p) {
  const v = CLASSES.map((c) => Math.max(0, +((p || {})[c]) || 0));
  const s = v.reduce((a, b) => a + b, 0);
  return s > 0 ? v.map((x) => x / s) : [0.25, 0.25, 0.25, 0.25];
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "*" } });
}

export async function POST(request) {
  try {
    if (API_TOKEN && request.headers.get("authorization") !== `Bearer ${API_TOKEN}`) return json({ detail: "invalid token" }, 401);
    if (!GEMINI_API_KEY) return json({ detail: "GEMINI_API_KEY is not set in Vercel environment variables" }, 500);
    const form = await request.formData();
    const file = form.get("image");
    if (!file || typeof file === "string") return json({ detail: "No image received" }, 400);
    const parse = (k, d) => { try { return JSON.parse(form.get(k) || d); } catch { return JSON.parse(d); } };
    const meta = parse("metadata", "{}"), hist = parse("history", "{}"), roiRaw = form.get("roi") || "[]";
    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const mime = file.type && file.type.startsWith("image/") ? file.type : "image/jpeg";
    const roi = roiRaw && roiRaw !== "[]" ? String(roiRaw).slice(0, 2000) : "none";

    const j = await askGemini(b64, mime, PROMPT(contextText(meta, hist, true), roi));
    if (j.oral_visible === false) return json({ not_assessable: true, message: NOT_ORAL_MESSAGE, model_version: MODEL_VERSION });
    const p = normProbs(j.probs);
    let s = j.suspicion != null ? +j.suspicion : p[2] + p[3];
    s = Math.min(1, Math.max(0, isNaN(s) ? p[2] + p[3] : s));
    let s0 = null;
    if (PHOTO_ONLY_CHECK) {
      const j0 = await askGemini(b64, mime, PROMPT(contextText(meta, hist, false), roi));
      const p0 = normProbs(j0.probs); s0 = j0.suspicion != null ? +j0.suspicion : p0[2] + p0[3];
    }
    let warning = null;
    if (j.intraoral === false) warning = "This does not look like an intraoral photograph.";
    else if (String(j.image_quality || "").toLowerCase() === "poor") warning = "Image quality is poor; consider retaking the photo.";
    return json({
      model_version: MODEL_VERSION,
      probs: Object.fromEntries(CLASSES.map((c, i) => [c, p[i]])),
      suspicion: s, suspicion_sd: null, suspicion_uniform_meta: s0,
      lesion_type: j.lesion_type || null, lesion_confidence: j.lesion_confidence ?? null,
      differential: Array.isArray(j.differential) ? j.differential.slice(0, 3) : [],
      findings: j.findings || "", image_quality: j.image_quality || null, warning,
      regions: Array.isArray(j.regions) ? j.regions.slice(0, 6) : [],
      engine_model: j.__model || GEMINI_MODEL,
    });
  } catch (e) {
    if (Array.isArray(e)) return json({ detail: e[1] }, e[0]);
    return json({ detail: "Server error: " + (e && e.message ? e.message : e) }, 500);
  }
}
