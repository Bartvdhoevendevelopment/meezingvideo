// ============================================================
// /api/find-lyrics  —  Meezingvideo songtekst-lookup
//
// Server-side multi-source scraper. Probeert in volgorde:
//   1. Sela.nl                    (als 'sela' in query)
//   2. DagelijkseBroodkruimels.nl (als 'opwekking' in query)
//   3. Songteksten.net            (altijd als laatste vangnet)
//
// Auth: vereist een geldige Supabase access_token.
// ============================================================

const SUPABASE_URL      = 'https://fxypkflcioegvexazqut.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4eXBrZmxjaW9lZ3ZleGF6cXV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNjc3NDksImV4cCI6MjA5NDk0Mzc0OX0.oOKWV56NXD9V3DBOB6Y3RXTBoFWs7Hr0BiJaIclmvbE';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ── Bronnen ─────────────────────────────────────────────────
const SOURCES = [
  {
    name:        'sela',
    label:       'Sela.nl',
    triggerRe:   /\bsela\b/i,
    searchTerm:  q => 'site:sela.nl/liederen ' + q,
    urlRe:       /https?:\/\/(?:www\.)?sela\.nl\/liederen\/\d+\/[^"'<>\s]+\.html/i,
    extract:     extractSela
  },
  {
    name:        'broodkruimels',
    label:       'DagelijkseBroodkruimels.nl',
    triggerRe:   /\bopwekking\b/i,
    searchTerm:  q => 'site:dagelijksebroodkruimels.nl/songteksten ' + q,
    urlRe:       /https?:\/\/(?:www\.)?dagelijksebroodkruimels\.nl\/songteksten\/[^"'<>\s]+/i,
    extract:     extractGeneric
  },
  {
    name:        'songtekstennet',
    label:       'Songteksten.net',
    triggerRe:   null, // altijd als vangnet
    searchTerm:  q => 'site:songteksten.net ' + q,
    urlRe:       /https?:\/\/(?:www\.)?songteksten\.net\/lyric\/[^"'<>\s]+\.html/i,
    extract:     extractSongtekstenNet
  }
];

// ── Handler ─────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Methode niet toegestaan' });

  // Auth
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Login vereist' });
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': auth }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sessie ongeldig of verlopen — log opnieuw in' });
  } catch (e) {
    return res.status(502).json({ error: 'Kan auth-server niet bereiken: ' + e.message });
  }

  // Query
  const q = (req.query.q || '').toString().trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'Geen zoekopdracht meegegeven' });

  // Volgorde bepalen op basis van triggers
  const primary   = SOURCES.filter(s => s.triggerRe && s.triggerRe.test(q));
  const fallbacks = SOURCES.filter(s => !primary.includes(s));
  const order     = [...primary, ...fallbacks];

  const attempts = [];
  for (const source of order) {
    try {
      const result = await tryFromSource(source, q);
      if (result?.lyrics) {
        return res.status(200).json({
          lyrics:   result.lyrics,
          source:   result.url,
          provider: source.label,
          tried:    attempts.concat({ provider: source.label, ok: true })
        });
      }
      attempts.push({ provider: source.label, ok: false, reason: 'geen tekst' });
    } catch (e) {
      attempts.push({ provider: source.label, ok: false, reason: e.message });
    }
  }

  // Niets gevonden
  const reasons = attempts.map(a => `${a.provider}: ${a.reason}`).join(' · ');
  return res.status(404).json({
    error: `Geen enkele bron leverde een tekst (${reasons}). Probeer een specifiekere query of zoek handmatig.`
  });
}

// ── Per-source pipeline ─────────────────────────────────────
async function tryFromSource(source, q) {
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(source.searchTerm(q))}`;

  let ddgRes;
  try { ddgRes = await fetch(ddgUrl, { headers: { 'User-Agent': UA } }); }
  catch (e) { throw new Error('zoekmachine onbereikbaar'); }
  if (!ddgRes.ok) throw new Error('zoekmachine gaf ' + ddgRes.status);

  const ddgHtml = await ddgRes.text();
  const m = ddgHtml.match(source.urlRe);
  if (!m) throw new Error('geen pagina gevonden');

  // DDG geeft soms URL-encoded redirects of html-encoded entiteiten
  let lyricUrl = m[0].replace(/&amp;/g, '&');
  // Sommige DDG-resultaten zitten achter een redirect-link "uddg=" — schoonmaken
  if (lyricUrl.includes('uddg=')) {
    const u = new URL(lyricUrl);
    const real = u.searchParams.get('uddg');
    if (real) lyricUrl = decodeURIComponent(real);
  }

  let pageRes;
  try { pageRes = await fetch(lyricUrl, { headers: { 'User-Agent': UA } }); }
  catch (e) { throw new Error('pagina onbereikbaar'); }
  if (!pageRes.ok) throw new Error('pagina gaf ' + pageRes.status);

  const pageHtml = await pageRes.text();
  const lyrics = source.extract(pageHtml);
  if (!lyrics) throw new Error('tekst niet uit pagina gehaald');
  return { lyrics, url: lyricUrl };
}

// ── Extractors ──────────────────────────────────────────────

// Sela.nl: tekst staat tussen <h2>{titel}</h2> en de regel "Tekst:" / "Muziek:"
function extractSela(html) {
  // Probeer eerst de generieke aanpak (JSON-LD, .lyrics selectors)
  const generic = extractGeneric(html);
  if (generic && generic.split('\n').length >= 4) return generic;

  // Heuristiek: zoek de h2-titel en knip alles tot "Tekst:" / "Muziek:" / "©"
  const h2Match = html.match(/<h2[^>]*>[^<]+<\/h2>/i);
  if (!h2Match) return null;
  const afterH2 = html.indexOf(h2Match[0]) + h2Match[0].length;

  // Sluit op de eerste meta-marker
  const endMarkers = [
    html.indexOf('Tekst:',       afterH2),
    html.indexOf('Muziek:',      afterH2),
    html.indexOf('Gratis blad',  afterH2),
    html.search(/©\s*\d{4}\s*Stichting/i)
  ].filter(i => i > afterH2);
  if (endMarkers.length === 0) return null;
  const endIdx = Math.min(...endMarkers);

  const middle = html.substring(afterH2, endIdx);
  const text = stripHtml(middle);
  if (text.split('\n').length < 3) return null;
  return text;
}

// Songteksten.net: zoals de oude implementatie
function extractSongtekstenNet(html) {
  const generic = extractGeneric(html);
  if (generic && generic.split('\n').length >= 4) return generic;

  // Heuristiek tussen <h1> en FEMU/disclaimer
  const h1 = html.search(/<h1[^>]*>/i);
  const femu = html.search(/(FEMU|toestemming van Stichting|laatst gewijzigd)/i);
  if (h1 !== -1 && femu !== -1 && femu > h1) {
    const middle = html.substring(h1, femu);
    const blockRe = /<(div|p|article|section)[^>]*>([\s\S]*?)<\/\1>/gi;
    let best = '', bestScore = 0;
    let m;
    while ((m = blockRe.exec(middle)) !== null) {
      const brCount = (m[2].match(/<br\s*\/?>/gi) || []).length;
      const cleaned = stripHtml(m[2]);
      const score = brCount * 5 + cleaned.length;
      if (brCount >= 4 && cleaned.length > 100 && score > bestScore) {
        best = cleaned; bestScore = score;
      }
    }
    if (best) return best;
  }
  return null;
}

// Generieke extractor: JSON-LD → bekende selectors → null
function extractGeneric(html) {
  // 1. JSON-LD
  const jsonLdRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      const arr = Array.isArray(obj) ? obj : [obj];
      for (const item of arr) {
        const txt = item?.lyrics?.text || item?.lyrics ||
                    (typeof item?.text === 'string' ? item.text : null);
        if (typeof txt === 'string' && txt.length > 80) return cleanText(txt);
      }
    } catch {}
  }

  // 2. Bekende selectors
  const patterns = [
    /<div[^>]*itemprop=["']text["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*itemprop=["']lyrics["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*lyric-body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*lyrics-body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*lyric_body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']lyric["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']lyrics["'][^>]*>([\s\S]*?)<\/div>/i,
    /<pre[^>]*class=["'][^"']*lyric[^"']*["'][^>]*>([\s\S]*?)<\/pre>/i,
    /<div[^>]*class=["'][^"']*songtext[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*songtekst[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const re of patterns) {
    const m2 = html.match(re);
    if (m2) {
      const text = stripHtml(m2[1]);
      if (text && text.split('\n').length >= 3 && text.length > 80) return text;
    }
  }
  return null;
}

// ── HTML → platte tekst ─────────────────────────────────────
function stripHtml(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi,  '\n')
    .replace(/<\/div>/gi,'\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g,  "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n');
}

function cleanText(s) {
  return s.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}
