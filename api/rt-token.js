export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { language, verbose } = req.body || {};
    // You can log these for debugging or enforce validation
    // console.log('Requested:', { language, verbose });

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // gpt-realtime is a placeholder name; use the exact model you enabled
        model: 'gpt-realtime',
        voice: 'verse',
        // Optionally pass default instructions here too, but we mostly set them client-side
        // We'll still echo back language/verbose as metadata if you want to use server-side
        // ...anything else required by your setup
      })
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: text });
    }

    const js = await r.json();
    // Return the short-lived secret
    return res.status(200).json({ client_secret: { value: js.client_secret?.value || js.client_secret } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal error minting token' });
  }
}
