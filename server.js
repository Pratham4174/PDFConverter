const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Proxy endpoint for Anthropic API
app.post('/api/optimize', async (req, res) => {
  try {
    const { model, max_tokens, messages } = req.body;

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY not configured on server.' } });
    }

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model, max_tokens, messages },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        timeout: 60000,
      }
    );

    res.json(response.data);

  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.error?.message || err.message || 'Internal server error';
    console.error('API Error:', message);
    res.status(status).json({ error: { message } });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 ResumeSync server running on http://localhost:${PORT}\n`);
});
