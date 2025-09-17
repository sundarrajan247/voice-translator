// api/rt-token.js — Vercel Serverless Function
// Returns an ephemeral client_secret for the browser to start a Realtime session.

export default async function handler(req, res) {
  // CORS for GitHub Pages -> Vercel calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  try {
    const { language = 'Spanish', verbose = false } = req.body || {};
    const verboseMode = typeof verbose === 'string'
      ? verbose.toLowerCase() === 'true'
      : Boolean(verbose);

    const baseInstructions =
      `You are a translator bot. The user may speak any language. ` +
      `Translate and reply ONLY in spoken ${language}.`;

    const instructions = verboseMode
      ? baseInstructions + ' Provide a detailed, word-by-word explanation of the translation so the listener understands how each segment maps to the final spoken response.'
      : baseInstructions + ' Keep replies concise and natural sounding.';

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-realtime',
        voice: 'verse',
        instructions
        // You can add other session options here later (tools, transcript events, etc.)
      }),
    });

    const text = await r.text();
    if (!r.ok) return res.status(r.status).send(text);

    const session = JSON.parse(text);
    // session.client_secret.value is what the browser needs
    return res.status(200).json({ client_secret: session.client_secret });
  } catch (e) {
    return res.status(500).send(String(e));
  }
}
