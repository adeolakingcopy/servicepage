Netlify + Hugging Face setup (free tier)

1) Environment variables (Netlify site > Site settings > Build & deploy > Environment):
   - HUGGING_FACE_API_KEY = <your HF API key (free tier)>
   - HUGGING_FACE_MODEL = google/flan-t5-small   # optional, default used by function

2) Function location:
   - The function is at `netlify/functions/chat.js`. Netlify will auto-deploy it.

3) Local testing (Netlify CLI):
   - Install Netlify CLI: `npm install -g netlify-cli`
   - Run locally: `netlify dev` (it will serve functions under `/.netlify/functions/*`)
   - Make sure to set env vars locally: `export HUGGING_FACE_API_KEY=...`

4) Notes:
   - A simple in-memory cache (per function instance) and a basic per-IP rate limit are implemented in the function.
   - Cache is ephemeral and lives only for the lifetime of the function container; for durable caching use an external store.
   - If you need lower latency, consider switching to an Edge Function or choose a smaller HF model.

5) Recommended model choices:
   - `google/flan-t5-small` — fast, small, free-friendly
   - `google/flan-t5-large` — better quality, slower
   - For conversational flow, choose a text2text model or a conversational HF model that supports long context.

6) Troubleshooting:
   - 500 with `HUGGING_FACE_API_KEY not configured` -> set env var and redeploy.
   - 429 rate limit -> upgrade HF plan or tune RATE_LIMIT in the function.
