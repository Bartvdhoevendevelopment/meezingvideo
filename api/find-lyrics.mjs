// ============================================================
// /api/find-lyrics  —  Meezingvideo AI songtekst lookup
//
// Wordt aangeroepen vanaf admin.html (tab Songtekst) en vraagt
// Claude Haiku om de tekst van een lied te geven.
//
// Auth: vereist een geldige Supabase access_token (admin-login).
// Env:  ANTHROPIC_API_KEY  (zet in Vercel project settings)
// ============================================================

const SUPABASE_URL      = 'https://fxypkflcioegvexazqut.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4eXBrZmxjaW9lZ3ZleGF6cXV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNjc3NDksImV4cCI6MjA5NDk0Mzc0OX0.oOKWV56NXD9V3DBOB6Y3RXTBoFWs7Hr0BiJaIclmvbE';
const MODEL             = 'claude-haiku-4-5-20251001';

export default async function handler(req, res) {
  // ── CORS ───────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Methode niet toegestaan' });

  // ── Auth: Supabase access_token verifiëren ─────────────────
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Login vereist (geen token meegegeven)' });
  }
  const accessToken = auth.slice(7);

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    if (!userRes.ok) {
      return res.status(401).json({ error: 'Sessie ongeldig of verlopen — log opnieuw in' });
    }
  } catch (e) {
    return res.status(502).json({ error: 'Kan auth-server niet bereiken: ' + e.message });
  }

  // ── Query valideren ────────────────────────────────────────
  const q = (req.query.q || '').toString().trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'Geen zoekopdracht meegegeven' });

  // ── API-key check ──────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'AI niet geconfigureerd. Voeg ANTHROPIC_API_KEY toe in Vercel → Project Settings → Environment Variables.'
    });
  }

  // ── Prompt opbouwen ────────────────────────────────────────
  const prompt = [
    'Je krijgt een liedtitel (en eventueel artiest). Geef terug de volledige, exacte songtekst.',
    '',
    'REGELS:',
    '1. Eén regel per zin (zoals op een lyric-site).',
    '2. Geen markers zoals [Refrein], [Chorus], [Verse 1] — laat ze weg.',
    '3. Geen lege regels tussen coupletten — alle regels direct achter elkaar.',
    '4. Herhaal refreinen letterlijk als ze in het origineel ook herhaald worden.',
    '5. Begin meteen met de eerste regel. GEEN inleiding, uitleg, of bronvermelding.',
    '6. Geef alleen de Nederlandstalige tekst (of de originele taal) — geen vertaling.',
    '7. Als je het lied niet kent of niet 100% zeker bent over de tekst, antwoord ALLEEN met deze exacte tekst (zonder iets erbij): NIET_GEVONDEN',
    '',
    `Zoekopdracht: "${q}"`
  ].join('\n');

  // ── Claude API call ────────────────────────────────────────
  let cRes;
  try {
    cRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json'
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 2000,
        messages:   [{ role: 'user', content: prompt }]
      })
    });
  } catch (e) {
    return res.status(502).json({ error: 'Kan Claude API niet bereiken: ' + e.message });
  }

  if (!cRes.ok) {
    const errTxt = await cRes.text();
    return res.status(502).json({ error: 'AI-fout (' + cRes.status + '): ' + errTxt.substring(0, 200) });
  }

  const data = await cRes.json();
  const text = (data?.content?.[0]?.text || '').trim();

  if (!text || /^NIET_GEVONDEN\b/i.test(text)) {
    return res.status(404).json({
      error: 'Claude kent dit lied niet of is onzeker. Probeer een specifiekere zoekopdracht (bv. titel + artiest), of zoek handmatig via de links rechtsonder.'
    });
  }

  return res.status(200).json({ lyrics: text, model: MODEL });
}
