const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
app.use(bodyParser.json());

// Serve static site from root/
const staticDir = path.resolve(__dirname, '..', 'root');
app.use(express.static(staticDir));

// Load Netlify function handler
const fn = require(path.resolve(__dirname, '..', 'netlify', 'functions', 'chat.js')).handler;

app.post('/.netlify/functions/chat', async (req, res) => {
  const event = {
    httpMethod: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body)
  };
  try {
    const result = await fn(event);
    // result is {statusCode, body}
    res.status(result.statusCode || 200).send(result.body);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const port = process.env.DEV_PORT || 5173;
app.listen(port, () => console.log(`Dev proxy running at http://localhost:${port} — site served from ${staticDir}`));
