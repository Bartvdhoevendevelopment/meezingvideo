// ============================================================
// /api/find-lyrics  —  Meezingvideo songtekst-lookup
//
// Geen zoekmachine meer (DDG/Bing geven 403 vanaf Vercel-IPs).
// Per bron hun eigen index-pagina ophalen en op titel matchen.
// Voor Opwekking werkt ook directe nummer-lookup
// ("Opwekking 281" -> /opwekking/281).
//
// Auth: vereist een geldige Supabase access_token.
// ============================================================

const SUPABASE_URL      = 'https://fxypkflcioegvexazqut.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4eXBrZmxjaW9lZ3ZleGF6cXV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNjc3NDksImV4cCI6MjA5NDk0Mzc0OX0.oOKWV56NXD9V3DBOB6Y3RXTBoFWs7Hr0BiJaIclmvbE';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let indexCacheDbk  = { data: null, time: 0 };
let indexCacheSela = { data: null, time: 0 };
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const SOURCES = [
  {
    name:    'sela',
    label:   'Sela.nl',
    matches: q => /\bsela\b/i.test(q),
    findUrl: findOnSela,
    extract: extractSela
  },
  {
    name:    'broodkruimels',
    label:   'DagelijkseBroodkruimels.nl',
    matches: q => /\bopwekking\b/i.test(q),
    findUrl: findOnDbk,
    extract: extractGeneric
  }
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Methode niet toegestaan' });

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Login vereist' });
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': auth }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sessie ongeldig - log opnieuw in' });
  } catch (e) {
    return res.status(502).json({ error: 'Kan auth-server niet bereiken: ' + e.message });
  }

  const q = (req.query.q || '').toString().trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'Geen zoekopdracht meegegeven' });

  const primary   = SOURCES.filter(s => s.matches(q));
  const fallbacks = SOURCES.filter(s => !primary.includes(s));
  const order     = [...primary, ...fallbacks];

  const tried = [];
  for (const source of order) {
    try {
      const found = await source.findUrl(q);
      if (!found?.url) { tried.push({ p: source.label, why: 'titel niet gevonden in index' }); continue; }

      const pageRes = await fetch(found.url, { headers: { 'User-Agent': UA } });
      if (!pageRes.ok) { tried.push({ p: source.label, why: 'pagina gaf ' + pageRes.status }); continue; }

      const html = await pageRes.text();
      const lyrics = source.extract(html);
      if (!lyrics) { tried.push({ p: source.label, why: 'kon tekst niet uit pagina halen' }); continue; }

      return res.status(200).json({
        lyrics,
        source:   found.url,
        provider: source.label,
        matched:  found.matched || null
      });
    } catch (e) {
      tried.push({ p: source.label, why: e.message || String(e) });
    }
  }

  const reasons = tried.map(t => t.p + ': ' + t.why).join(' / ');
  return res.status(404).json({
    error: 'Geen bron leverde een tekst (' + reasons + '). Probeer een specifiekere query (bv. "Opwekking 281" of "Ik zal er zijn Sela"), of zoek handmatig via de links hieronder.'
  });
}

// ── Sela.nl ─────────────────────────────────────────────────
async function findOnSela(query) {
  const index = await getSelaIndex();
  if (!index.length) return null;
  const cleaned = query.replace(/\bsela\b/gi, '').trim();
  const best = bestTitleMatch(index, cleaned);
  if (!best) return null;
  return { url: best.url, matched: best.title };
}

async function getSelaIndex() {
  if (indexCacheSela.data && (Date.now() - indexCacheSela.time) < CACHE_TTL_MS) {
    return indexCacheSela.data;
  }
  const res = await fetch('https://www.sela.nl/liederen', { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Sela index gaf ' + res.status);
  const html = await res.text();

  const items = [];
  const re = /<a[^>]*href="(\/liederen\/\d+\/[^"]+\.html)"[^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = 'https://www.sela.nl' + m[1];
    const title = m[2].trim();
    if (title && title.length < 120) items.push({ url, title });
  }
  const seen = new Set();
  const unique = items.filter(i => { if (seen.has(i.url)) return false; seen.add(i.url); return true; });
  indexCacheSela = { data: unique, time: Date.now() };
  return unique;
}

// ── DagelijkseBroodkruimels.nl ─────────────────────────────
async function findOnDbk(query) {
  const numMatch = query.match(/\bopwekking\s*(?:nr\.?|nummer)?\s*(\d{1,4})\b/i);
  if (numMatch) {
    return {
      url: 'https://dagelijksebroodkruimels.nl/songteksten/opwekking/' + numMatch[1],
      matched: 'Opwekking ' + numMatch[1]
    };
  }
  const index = await getDbkIndex();
  if (!index.length) return null;
  const cleaned = query.replace(/\bopwekking\b/gi, '').replace(/\bnr\.?\b/gi, '').trim();
  const best = bestTitleMatch(index, cleaned);
  if (!best) return null;
  return { url: best.url, matched: best.title };
}

async function getDbkIndex() {
  if (indexCacheDbk.data && (Date.now() - indexCacheDbk.time) < CACHE_TTL_MS) {
    return indexCacheDbk.data;
  }
  const res = await fetch('https://dagelijksebroodkruimels.nl/songteksten/opwekking', {
    headers: { 'User-Agent': UA }
  });
  if (!res.ok) throw new Error('DBK index gaf ' + res.status);
  const html = await res.text();

  const items = new Map();
  // Match "N - Titel" patronen (komen voor in title attributes en linktekst)
  const re = /(\d{1,4})\s*-\s*([^"<>\n\r]{3,100}?)(?:\s*-\s*DagelijkseBroodkruimels)?["<]/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const num = parseInt(m[1], 10);
    if (num < 1 || num > 9999) continue;
    const title = m[2].trim();
    if (!items.has(num)) {
      items.set(num, {
        url: 'https://dagelijksebroodkruimels.nl/songteksten/opwekking/' + num,
        title
      });
    }
  }
  const arr = [...items.values()];
  indexCacheDbk = { data: arr, time: Date.now() };
  return arr;
}

// ── Titel-matching ─────────────────────────────────────────
function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bestTitleMatch(items, query) {
  const qn = normalize(query);
  if (!qn) return null;
  const qWords = qn.split(' ').filter(w => w.length >= 3);
  if (qWords.length === 0) return null;

  let best = null, bestScore = 0;
  for (const item of items) {
    const tn = normalize(item.title);
    if (!tn) continue;
    let score = 0;
    for (const w of qWords) if (tn.includes(w)) score++;
    if (tn === qn) score += 100;
    if (tn.startsWith(qn)) score += 10;
    if (qn.startsWith(tn) && tn.length > 5) score += 8;
    if (tn.length > qn.length * 3) score -= 1;
    if (score > bestScore) { best = item; bestScore = score; }
  }
  if (bestScore < Math.ceil(qWords.length / 2)) return null;
  return best;
}

// ── Lyrics extractors ──────────────────────────────────────
function extractSela(html) {
  const generic = extractGeneric(html);
  if (generic && generic.split('\n').length >= 4) return generic;

  const h2Match = html.match(/<h2[^>]*>[^<]+<\/h2>/i);
  if (!h2Match) return null;
  const afterH2 = html.indexOf(h2Match[0]) + h2Match[0].length;
  const ends = [
    html.indexOf('Tekst:',      afterH2),
    html.indexOf('Muziek:',     afterH2),
    html.indexOf('Gratis blad', afterH2),
    html.search(/(?:©|&copy;)\s*\d{4}\s*Stichting/i)
  ].filter(i => i > afterH2);
  if (!ends.length) return null;
  const middle = html.substring(afterH2, Math.min(...ends));
  const text = stripHtml(middle);
  if (text.split('\n').length < 3) return null;
  return text;
}

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
    /<div[^>]*id=["']lyrics?["'][^>]*>([\s\S]*?)<\/div>/i,
    /<pre[^>]*class=["'][^"']*lyric[^"']*["'][^>]*>([\s\S]*?)<\/pre>/i,
    /<div[^>]*class=["'][^"']*songtekst[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const re of patterns) {
    const m2 = html.match(re);
    if (m2) {
      const text = stripHtml(m2[1]);
      if (text && text.split('\n').length >= 3 && text.length > 80) return text;
    }
  }

  // 3. Heuristiek: grootste tekstblok in main/article
  const mainMatch = html.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  const scope = mainMatch ? mainMatch[1] : html;
  const blockRe = /<(div|p|section|pre)[^>]*>([\s\S]*?)<\/\1>/gi;
  let best = '', bestScore = 0;
  let mm;
  while ((mm = blockRe.exec(scope)) !== null) {
    if (/nav|menu|footer|header|sidebar|breadcrumb|advert|cookie/i.test(mm[2].slice(0, 200))) continue;
    const brCount   = (mm[2].match(/<br\s*\/?>/gi) || []).length;
    const cleaned   = stripHtml(mm[2]);
    const lineCount = cleaned.split('\n').length;
    const score     = brCount * 5 + lineCount * 3 + Math.min(cleaned.length, 2000);
    if (lineCount >= 4 && cleaned.length > 100 && score > bestScore) {
      best = cleaned; bestScore = score;
    }
  }
  return best || null;
}

function stripHtml(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi,   '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi,  '\n')
    .replace(/<[^>]+>/g,  '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'").replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'").replace(/&apos;/g, "'")
    .replace(/\r/g, '')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

function cleanText(s) {
  return s.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}
