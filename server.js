#!/usr/bin/env node
/* Simple Express proxy to forward chat messages to OpenAI.
   Usage: set OPENAI_API_KEY in env and run `node server.js`.
   POST /api/chat { message: string, history: [{role, content}] }
   Response: { reply: string }
*/

const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.warn('Warning: OPENAI_API_KEY not set. /api/chat will return error until it is provided.');
}

app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });
  if (!OPENAI_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' });

  try {
    // Build messages array for chat completion - include recent history if provided
    const messages = [];
    if (Array.isArray(history)) {
      history.slice(-8).forEach(h => {
        if (h.role && h.content) messages.push({ role: h.role, content: h.content });
      });
    }
    messages.push({ role: 'user', content: message });

    // Call OpenAI Chat Completions
    const payload = {
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 800,
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: text });
    }

    const data = await r.json();
    const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || data.choices?.[0]?.text || '';
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Chat proxy running on http://localhost:${port} — set OPENAI_API_KEY to enable.`));
