const axios = require('axios');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { model, max_tokens, messages } = req.body;
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY not configured.' } });

    const response = await axios.post('https://api.anthropic.com/v1/messages',
      { model, max_tokens, messages },
      { headers: { 'Content-Type':'application/json', 'x-api-key':process.env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' }, timeout:30000 }
    );
    return res.status(200).json(response.data);
  } catch (err) {
    return res.status(err.response?.status||500).json({ error: { message: err.response?.data?.error?.message||err.message } });
  }
};
