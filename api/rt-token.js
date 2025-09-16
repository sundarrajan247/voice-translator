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
    const instructionParts = [
      `You are a literal translation assistant. The user may speak any language.`,
      `For every user utterance, provide a faithful, literal translation into ${language}.`,
      `Do not answer questions or add commentary—only translate what the user said.`,
      `Respond out loud exclusively with the translated sentence in ${language}.`
    ];

    if (verbose) {
      instructionParts.push(
        `After you finish speaking, send exactly one JSON message over the "oai-events" data channel ` +
          `with the shape {"type":"translation.breakdown","source":"<source sentence>",` +
          `"target":"<translated sentence>","breakdown":[{"source":"<source word>",` +
          `"target":"<translated word>","meaning":"<short meaning>"},…]}.`,
        `Include every meaningful word in the breakdown with short English glosses.`,
        `Do not speak the breakdown out loud and do not send any other commentary.`
      );
    } else {
      instructionParts.push(`Do not provide explanations, definitions, or follow-up remarks.`);
    }

    const instructions = instructionParts.join(' ');

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
