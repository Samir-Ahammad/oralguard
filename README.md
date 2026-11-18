# OralGuard demo on Vercel (app + interim Gemini service, no Docker)

Upload this whole folder to a GitHub repository and import it into Vercel.
- index.html: the app
- api/predict.js: interim model service (Gemini), called by the app
- api/health.js: connection test
- vercel.json, package.json: settings (up to 60 s per call)

Environment variables (Vercel > Project > Settings > Environment Variables):
- GEMINI_API_KEY (required)
- GEMINI_MODEL: exact model code from AI Studio Get code
- optional: API_TOKEN, PHOTO_ONLY_CHECK=1, MODEL_VERSION

In the app: Programme admin > Governance > Model connection > Connected model service > URL = https://<your-project>.vercel.app/api > Save > Test connection.
