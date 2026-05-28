// ============================================================
// /api/find-lyrics  —  Meezingvideo songtekst-lookup
//
// Index-based scraper (geen zoekmachine).
// Per bron eigen extractor + sanity-check.
// DBK is Next.js -> __NEXT_DATA__ JSON wordt geparsed.
// ============================================================

const SUPABASE_URL      = 'https://fxypkflcioegvexazqut.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4eXBrZmxjaW9lZ3ZleGF6cXV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNjc3NDksImV4cCI6MjA5NDk0Mzc0OX0.oOKWV56NXD9V3DBOB6Y3RXTBoFWs7Hr0BiJaIclmvbE';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let indexCacheDbk  = { data: null, time: 0 };
let indexCacheSela = { data: null, time: 0 };
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const SOURCES = [
  { name: 'sela',          label: 'Sela.nl',                    matches: q => /\bsela\b/i.test(q),      findUrl: findOnSela, extract: extractSela },
  { name: 'broodkruimels', label: 'DagelijkseBroodkruimels.nl', matches: q => /\bopwekking\b/i.test(q), findUrl: findOnDbk,  extract: extractDbk  }
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
  const debug = req.query.debug === '1';

  const primary   = SOURCES.filter(s => s.matches(q));
  const fallbacks = SOURCES.filter(s => !primary.includes(s));
  const order     = [...primary, ...fallbacks];

  const tried = [];
  for (const source of order) {
    try {
      const found = await source.findUrl(q);
      if (!found?.url) { tried.push({ p: source.label, why: 'titel niet in index' }); continue; }

      const pageRes = await fetch(found.url, { headers: { 'User-Agent': UA } });
      if (!pageRes.ok) { tried.push({ p: source.label, why: 'pagina ' + pageRes.status, url: found.url }); continue; }

      const html = await pageRes.text();
      const lyrics = source.extract(html);

      if (!lyrics) { tried.push({ p: source.label, why: 'tekst niet uit pagina gehaald', url: found.url }); continue; }
      if (!looksLikeLyrics(lyrics)) { tried.push({ p: source.label, why: 'pagina bevatte geen liedtekst (navigatie/product)', url: found.url }); continue; }

      return res.status(200).json({
        lyrics,
        source:   found.url,
        provider: source.label,
        matched:  found.matched || null,
        tried:    debug ? tried : undefined
      });
    } catch (e) {
      tried.push({ p: source.label, why: e.message || String(e) });
    }
  }

  const reasons = tried.map(t => t.p + ': ' + t.why).join(' / ');
  return res.status(404).json({
    error: 'Geen bron leverde een tekst (' + reasons + '). Probeer "Opwekking 281" of "Ik zal er zijn Sela", of zoek handmatig via de links hieronder.',
    tried
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
  if (!res.ok) throw new Error('Sela index ' + res.status);
  const html = await res.text();

  const items = [];
  const re = /<a[^>]*href="(?:https?:\/\/(?:www\.)?sela\.nl)?(\/liederen\/\d+\/[^"]+\.html)"[^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = 'https://www.sela.nl' + m[1];
    const title = m[2].replace(/&amp;/g, '&').trim();
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
    return { url: 'https://dagelijksebroodkruimels.nl/songteksten/opwekking/' + numMatch[1], matched: 'Opwekking ' + numMatch[1] };
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
  const res = await fetch('https://dagelijksebroodkruimels.nl/songteksten/opwekking', { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('DBK index ' + res.status);
  const html = await res.text();

  const items = new Map();
  const re = /(\d{1,4})\s*-\s*([^"<>\n\r]{3,100}?)(?:\s*-\s*DagelijkseBroodkruimels)?["<]/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const num = parseInt(m[1], 10);
    if (num < 1 || num > 9999) continue;
    const title = m[2].trim();
    if (!items.has(num)) {
      items.set(num, { url: 'https://dagelijksebroodkruimels.nl/songteksten/opwekking/' + num, title });
    }
  }
  const arr = [...items.values()];
  indexCacheDbk = { data: arr, time: Date.now() };
  return arr;
}

// ── Titel-matching ─────────────────────────────────────────
function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
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

// ── Sanity-check: lijkt dit op songtekst of op nav/product? ─
function looksLikeLyrics(text) {
  if (!text || text.length < 60) return false;
  const lineCount = text.split('\n').filter(l => l.trim()).length;
  if (lineCount < 3) return false;
  const blocklist = ['inloggen','winkelmand','webshop','producten','algemene voorwaarden','privacy','cookies','beoordelingen','newsletter','nieuwsbrief','bezorging','retourneren','kvk','btw','klarna','sepa','mastercard','bancontact','postnl','instagram','facebook','pinterest','spotify','identiteiten','kruimels'];
  const lower = text.toLowerCase();
  let hits = 0;
  for (const w of blocklist) if (lower.includes(w)) hits++;
  if (hits >= 3) return false;
  return true;
}

// ── DBK extractor: Next.js __NEXT_DATA__ → fallback heuristiek ─
function extractDbk(html) {
  const fromNext = extractFromNextData(html);
  if (fromNext) return fromNext;
  return extractAfterH1(html);
}

function extractFromNextData(html) {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  return findLyricsInObject(data, 0);
}

function findLyricsInObject(obj, depth) {
  if (depth > 12 || obj == null) return null;
  if (typeof obj === 'string') {
    const text = obj.replace(/\r/g, '').trim();
    const lineCount = text.split('\n').filter(l => l.trim()).length;
    if (text.length >= 120 && lineCount >= 4 && /[a-zA-Z]/.test(text) && !text.startsWith('http') && !/^[\[\{]/.test(text) && !text.startsWith('/')) {
      const stripped = stripHtml(text);
      if (stripped && stripped.split('\n').length >= 4 && looksLikeLyrics(stripped)) return stripped;
    }
    return null;
  }
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const r = findLyricsInObject(it, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof obj === 'object') {
    const prio = ['lyrics','songtext','songtekst','text','body','content','tekst','description'];
    for (const k of prio) {
      if (k in obj) {
        const r = findLyricsInObject(obj[k], depth + 1);
        if (r) return r;
      }
    }
    for (const k of Object.keys(obj)) {
      if (prio.includes(k)) continue;
      const r = findLyricsInObject(obj[k], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function extractAfterH1(html) {
  const h1m = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/i);
  if (!h1m) return null;
  const after = html.indexOf(h1m[0]) + h1m[0].length;
  const stops = [html.search(/<footer/i), html.search(/<nav/i), html.search(/Inspiratie/), html.search(/Veelgestelde vragen/i)].filter(i => i > after);
  const end = stops.length ? Math.min(...stops) : html.length;
  const middle = html.substring(after, end);
  const text = stripHtml(middle);
  if (text.split('\n').length < 4) return null;
  return text;
}

// ── Sela extractor ─────────────────────────────────────────
function extractSela(html) {
  const jsonLd = extractFromJsonLd(html);
  if (jsonLd) return jsonLd;

  const h2m = html.match(/<h2[^>]*>[^<]+<\/h2>/i);
  if (!h2m) return extractAfterH1(html);
  const after = html.indexOf(h2m[0]) + h2m[0].length;
  const stops = [html.indexOf('Tekst:', after), html.indexOf('Muziek:', after), html.indexOf('Gratis blad', after), html.search(/(?:©|&copy;)\s*\d{4}\s*Stichting/i)].filter(i => i > after);
  if (!stops.length) return null;
  const middle = html.substring(after, Math.min(...stops));
  const text = stripHtml(middle);
  if (text.split('\n').length < 3) return null;
  return text;
}

function extractFromJsonLd(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      const arr = Array.isArray(obj) ? obj : [obj];
      for (const item of arr) {
        const txt = item?.lyrics?.text || item?.lyrics || (typeof item?.text === 'string' ? item.text : null);
        if (typeof txt === 'string' && txt.length > 80) return cleanText(txt);
      }
    } catch {}
  }
  return null;
}

function stripHtml(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<\/li>/gi, '\n').replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&apos;/g, "'")
    .replace(/\r/g, '')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

function cleanText(s) {
  return s.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}
