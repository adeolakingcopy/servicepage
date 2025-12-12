// Netlify Function: proxied chat to Hugging Face Inference API
// Set environment variables on Netlify:
// - HUGGING_FACE_API_KEY (required)
// - HUGGING_FACE_MODEL (optional, defaults to "google/flan-t5-small")

const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

// Simple in-memory cache (per-function-instance). Default TTL and size can be tuned via env vars
const CACHE = new Map();
const CACHE_TTL = parseInt(process.env.CACHE_TTL_MS || String(1000 * 60 * 5), 10); // default 5 minutes
const CACHE_MAX = parseInt(process.env.CACHE_MAX || '2000', 10);

// Simple rate limiter per IP (sliding window approximation)
const RATE = new Map();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '60', 10); // requests per window
const RATE_WINDOW_MS = parseInt(process.env.RATE_WINDOW_MS || String(60 * 1000), 10); // window size in ms

function getClientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] || h['x-forwarded-for'] && h['x-forwarded-for'].split(',')[0].trim() || h['x-client-ip'] || 'unknown';
}

exports.handler = async function(event) {
  const ip = getClientIp(event);
  // basic rate limiting
  const now = Date.now();
  const entry = RATE.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  RATE.set(ip, entry);
  if (entry.count > RATE_LIMIT) {
    return { statusCode: 429, body: JSON.stringify({ error: 'Rate limit exceeded' }) };
  }

  // cleanup small: remove old rate entries occasionally
  if (RATE.size > 10000) {
    for (const [k, v] of RATE) if (now - v.windowStart > RATE_WINDOW_MS * 5) RATE.delete(k);
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const body = JSON.parse(event.body || '{}');
  const message = body.message || '';
  if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'message required' }) };

  const HF_KEY = process.env.HUGGING_FACE_API_KEY;
  const HF_MODEL = process.env.HUGGING_FACE_MODEL || 'google/flan-t5-small';

  // Enable a local/dev mock when MOCK_HF=1 or when running in development
  const MOCK_HF = process.env.MOCK_HF === '1' || process.env.NODE_ENV === 'development';

  if (!HF_KEY && !MOCK_HF) return { statusCode: 500, body: JSON.stringify({ error: 'HUGGING_FACE_API_KEY not configured' }) };

  try {
    // simple cache key
    const cacheKey = `${HF_MODEL}::${message.trim().toLowerCase()}`;

    // Try Upstash Redis (REST) if configured for persistent caching
    const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
    const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (UPSTASH_URL && UPSTASH_TOKEN) {
      try {
        const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(cacheKey)}`, {
          method: 'GET', headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
        });
        if (r.ok) {
          const jd = await r.json();
          if (jd && jd.result) {
            return { statusCode: 200, body: JSON.stringify({ reply: jd.result, cached: true, persistent: true }) };
          }
        }
      } catch (e) { /* ignore upstream cache errors */ }
    }

    const cached = CACHE.get(cacheKey);
    if (cached && (Date.now() < cached.expires)) {
      return { statusCode: 200, body: JSON.stringify({ reply: cached.reply, cached: true }) };
    }

    // Development/mock mode: return a canned reply without calling HF
    if (MOCK_HF) {
      const reply = `Simulated reply (mock): I can help with websites, motion graphics, and messaging. You asked: "${message}"`;
      try {
        CACHE.set(cacheKey, { reply, expires: Date.now() + CACHE_TTL });
      } catch (e) {}
      return { statusCode: 200, body: JSON.stringify({ reply, mock: true }) };
    }
    // Build payload for HF text generation
    const payload = {
      inputs: message,
      parameters: { max_new_tokens: 256, temperature: 0.7 }
    };

    const res = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      return { statusCode: res.status, body: JSON.stringify({ error: text }) };
    }

    const data = await res.json();
    // HF returns array or object depending on model; handle common shapes
    let reply = '';
    if (Array.isArray(data) && data[0] && (data[0].generated_text || data[0].summary_text)) {
      reply = data[0].generated_text || data[0].summary_text;
    } else if (data.generated_text) {
      reply = data.generated_text;
    } else if (typeof data === 'string') {
      reply = data;
    } else if (Array.isArray(data) && data[0] && typeof data[0] === 'string') {
      reply = data[0];
    } else {
      // fallback: stringify
      reply = JSON.stringify(data).slice(0, 2000);
    }

    // store in in-memory cache
    try {
      CACHE.set(cacheKey, { reply, expires: Date.now() + CACHE_TTL });
      // cleanup if cache grows too big
      if (CACHE.size > CACHE_MAX) {
        const it = CACHE.keys();
        for (let i = 0; i < Math.min(200, CACHE.size); i++) { const k = it.next(); if (k.done) break; CACHE.delete(k.value); }
      }
    } catch (e) { console.warn('Cache error', e && e.message); }

    // store in Upstash (optional) for persistent caching
    if (UPSTASH_URL && UPSTASH_TOKEN) {
      try {
        const ttlSec = Math.floor(CACHE_TTL / 1000);
        await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(cacheKey)}`, {
          method: 'POST', headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: reply, ex: ttlSec })
        });
      } catch (e) { /* ignore persistent cache errors */ }
    }

    return { statusCode: 200, body: JSON.stringify({ reply }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
