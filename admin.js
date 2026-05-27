/* ============================================================
   admin.js  —  Meezingvideo beheermodule (V2, tab-based)
   ============================================================ */

// ── Supabase client ─────────────────────────────────────────
const { createClient } = supabase;
const { supabaseUrl, supabaseAnonKey } = window.MEEZINGVIDEO_CONFIG;
const db = createClient(supabaseUrl, supabaseAnonKey);

// ── State ───────────────────────────────────────────────────
let currentSong   = null;
let lines         = [];
let allSongs      = [];
let songPage      = 0;
let lyricsPage    = 0;
let timingPage    = 0;
let activeTab     = 'library';
let ytPlayer      = null;
let ytReady       = false;
let timeInterval  = null;
let lastTimeSec   = 0;

// Pagination sizes — bepaalt hoeveel rows er per pagina in beeld komen
const SONGS_PER_PAGE   = 8;
const LYRICS_PER_PAGE  = 9;
const TIMING_PER_PAGE  = 8;

// ── YouTube IFrame API ───────────────────────────────────────
window.onYouTubeIframeAPIReady = function () { ytReady = true; };

function initYT(videoId) {
  if (!videoId) return;
  if (ytPlayer && ytPlayer.loadVideoById) { ytPlayer.loadVideoById(videoId); return; }
  if (!ytReady) { setTimeout(() => initYT(videoId), 200); return; }
  ytPlayer = new YT.Player('adminYtPlayer', {
    height: '100%', width: '100%',
    videoId,
    playerVars: { rel: 0, modestbranding: 1 },
    events: {
      onReady: () => {
        clearInterval(timeInterval);
        timeInterval = setInterval(() => {
          if (ytPlayer?.getCurrentTime) {
            lastTimeSec = ytPlayer.getCurrentTime();
            const el = document.getElementById('currentTimeLabel');
            if (el) el.textContent = lastTimeSec.toFixed(2) + 's';
            highlightActiveTimingRow(lastTimeSec);
          }
        }, 200);
      }
    }
  });
}

// ── Hulpfuncties ────────────────────────────────────────────
function extractVideoId(raw) {
  raw = (raw || '').trim();
  const m = raw.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (raw.length === 11 ? raw : null);
}

function toast(msg, ok = true) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast ' + (ok ? 'show' : 'show error');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show', 'error'), 3000);
}

function fmtTime(sec) {
  const s = parseFloat(sec) || 0;
  const m = Math.floor(s / 60);
  const ss = (s - m * 60).toFixed(2).padStart(5, '0');
  return m > 0 ? `${m}:${ss}` : `${ss}s`;
}

function sortLines() {
  lines.sort((a, b) => parseFloat(a.time) - parseFloat(b.time));
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Tab switching ────────────────────────────────────────────
function switchTab(name) {
  activeTab = name;
  document.querySelectorAll('.adm-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.adm-panel').forEach(p => {
    const match = p.dataset.tab === name;
    p.classList.toggle('active', match);
    p.hidden = !match;
  });
  // wanneer naar timing geschakeld wordt en de video nog niet geïnit is, doe het nu
  if (name === 'timing' && currentSong?.youtube_id) initYT(currentSong.youtube_id);
  if (name === 'lyrics') renderLyricsList();
  if (name === 'timing') renderTimingList();
}

function setTabsEnabled(songSelected) {
  ['lyrics', 'timing'].forEach(tab => {
    const btn = document.querySelector(`.adm-tab[data-tab="${tab}"]`);
    if (btn) btn.disabled = !songSelected;
  });
}

// ── Song context bar in header ───────────────────────────────
function updateSongContext() {
  const ctx = document.getElementById('songContext');
  if (!ctx) return;
  if (currentSong?.title) {
    ctx.hidden = false;
    document.getElementById('songContextTitle').textContent = currentSong.title;
    document.getElementById('songContextArtist').textContent = currentSong.artist ? '· ' + currentSong.artist : '';
  } else {
    ctx.hidden = true;
  }
}

// ── Songenlijst laden ────────────────────────────────────────
async function loadSongs() {
  const { data, error } = await db.from('meezingvideo_songs')
    .select('id,title,artist,youtube_id,description').order('title');
  if (error) { toast('Fout bij laden liederen: ' + error.message, false); return; }
  allSongs = data || [];
  renderSongGrid();
}

function getFilteredSongs() {
  const q = (document.getElementById('songFilter')?.value || '').toLowerCase();
  if (!q) return allSongs;
  return allSongs.filter(s =>
    (s.title || '').toLowerCase().includes(q) ||
    (s.artist || '').toLowerCase().includes(q)
  );
}

function renderSongGrid() {
  const grid = document.getElementById('songGrid');
  const songs = getFilteredSongs();
  const totalPages = Math.max(1, Math.ceil(songs.length / SONGS_PER_PAGE));
  if (songPage >= totalPages) songPage = totalPages - 1;
  if (songPage < 0) songPage = 0;
  const slice = songs.slice(songPage * SONGS_PER_PAGE, (songPage + 1) * SONGS_PER_PAGE);

  grid.innerHTML = '';
  if (slice.length === 0) {
    grid.innerHTML = `<p class="adm-helper" style="text-align:center;padding:20px 0;">Geen liederen gevonden${getFilteredSongs() !== allSongs ? ' (filter actief)' : ''}.</p>`;
  } else {
    slice.forEach(song => {
      const btn = document.createElement('button');
      btn.className = 'adm-song-card' + (currentSong?.id === song.id ? ' active' : '');
      btn.innerHTML = `
        <div class="adm-song-card-text">
          <div class="adm-song-card-title">${escHtml(song.title)}</div>
          <div class="adm-song-card-artist">${escHtml(song.artist || '—')}</div>
        </div>
        <svg class="adm-song-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <path d="M9 6l6 6-6 6"/>
        </svg>
      `;
      btn.addEventListener('click', () => selectSong(song.id));
      grid.appendChild(btn);
    });
  }

  // Pager
  const pager = document.getElementById('songPager');
  if (totalPages > 1) {
    pager.hidden = false;
    document.getElementById('songPagerLabel').textContent = `${songPage + 1} / ${totalPages}`;
    pager.querySelector('[data-dir="-1"]').disabled = songPage === 0;
    pager.querySelector('[data-dir="1"]').disabled  = songPage >= totalPages - 1;
  } else {
    pager.hidden = true;
  }
}

// ── Lied selecteren ──────────────────────────────────────────
async function selectSong(id) {
  const { data: song, error: e1 } = await db.from('meezingvideo_songs')
    .select('*').eq('id', id).single();
  if (e1) { toast('Fout: ' + e1.message, false); return; }

  const { data: lyricsData } = await db.from('meezingvideo_lyrics')
    .select('*').eq('song_id', id).order('time');

  currentSong = song;
  lines = (lyricsData || []).map(r => ({ id: r.id, time: r.time, text: r.text }));
  lyricsPage = 0; timingPage = 0;

  // Vul detail-form
  document.getElementById('fieldTitle').value       = song.title || '';
  document.getElementById('fieldArtist').value      = song.artist || '';
  document.getElementById('fieldYoutube').value     = song.youtube_id || '';
  document.getElementById('fieldDescription').value = song.description || '';
  document.getElementById('editorTitle').textContent = 'Lied bewerken';
  document.getElementById('editorEmpty').hidden = true;
  document.getElementById('editor').hidden = false;
  document.getElementById('deleteSongBtn').hidden = false;

  updateSongContext();
  updateSearchQuery();
  setTabsEnabled(true);
  renderSongGrid();
  renderLyricsList();
  renderTimingList();

  if (activeTab === 'timing' && song.youtube_id) initYT(song.youtube_id);
}

// ── Nieuw lied ───────────────────────────────────────────────
function newSong() {
  currentSong = null;
  lines = [];
  document.getElementById('fieldTitle').value       = '';
  document.getElementById('fieldArtist').value      = '';
  document.getElementById('fieldYoutube').value     = '';
  document.getElementById('fieldDescription').value = '';
  document.getElementById('editorTitle').textContent = 'Nieuw lied';
  document.getElementById('editorEmpty').hidden = true;
  document.getElementById('editor').hidden = false;
  document.getElementById('deleteSongBtn').hidden = true;
  updateSongContext();
  updateSearchQuery();
  setTabsEnabled(false); // pas na opslaan komen tab 2 en 3 vrij
  renderSongGrid();
  document.getElementById('fieldTitle').focus();
}

// ── Lied opslaan ─────────────────────────────────────────────
async function saveSong() {
  const title      = document.getElementById('fieldTitle').value.trim();
  const artist     = document.getElementById('fieldArtist').value.trim();
  const ytRaw      = document.getElementById('fieldYoutube').value.trim();
  const description= document.getElementById('fieldDescription').value.trim();
  const youtube_id = extractVideoId(ytRaw) || ytRaw;

  if (!title) { toast('Vul een titel in', false); return; }

  const payload = { title, artist, youtube_id, description };
  let songId;

  if (currentSong?.id) {
    const { error } = await db.from('meezingvideo_songs').update(payload).eq('id', currentSong.id);
    if (error) { toast('Fout: ' + error.message, false); return; }
    songId = currentSong.id;
  } else {
    const { data, error } = await db.from('meezingvideo_songs').insert(payload).select().single();
    if (error) { toast('Fout: ' + error.message, false); return; }
    songId = data.id;
  }

  currentSong = { ...payload, id: songId };
  updateSongContext();
  setTabsEnabled(true);
  toast('Lied opgeslagen ✓');
  await loadSongs();
}

// ── Lied verwijderen ─────────────────────────────────────────
async function deleteSong() {
  if (!currentSong?.id) return;
  if (!confirm(`Weet je zeker dat je "${currentSong.title}" wilt verwijderen?\n\nDit verwijdert ook alle bijbehorende songtekstregels.`)) return;
  await db.from('meezingvideo_lyrics').delete().eq('song_id', currentSong.id);
  await db.from('meezingvideo_songs').delete().eq('id', currentSong.id);
  currentSong = null;
  lines = [];
  document.getElementById('editor').hidden = true;
  document.getElementById('editorEmpty').hidden = false;
  updateSongContext();
  setTabsEnabled(false);
  toast('Lied verwijderd');
  loadSongs();
}

// ── Tab 2: Songtekst-editor (compact, tekst-focus) ───────────
function renderLyricsList() {
  const list = document.getElementById('lyricsList');
  const count = document.getElementById('lineCount');
  if (!list) return;
  count.textContent = lines.length;

  if (!currentSong) {
    list.innerHTML = `<div class="adm-lyrics-empty">Selecteer eerst een lied in tab "Liedbeheer".</div>`;
    document.getElementById('lyricsPager').hidden = true;
    return;
  }

  if (lines.length === 0) {
    list.innerHTML = `<div class="adm-lyrics-empty">Nog geen regels. Klik op <strong>+ Regel</strong> of zoek de tekst online (paneel rechts).</div>`;
    document.getElementById('lyricsPager').hidden = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(lines.length / LYRICS_PER_PAGE));
  if (lyricsPage >= totalPages) lyricsPage = totalPages - 1;
  if (lyricsPage < 0) lyricsPage = 0;
  const start = lyricsPage * LYRICS_PER_PAGE;
  const slice = lines.slice(start, start + LYRICS_PER_PAGE);

  list.innerHTML = '';
  slice.forEach((line, idxInPage) => {
    const i = start + idxInPage;
    const row = document.createElement('div');
    row.className = 'adm-lyrics-row';
    row.innerHTML = `
      <span class="row-num">${i + 1}</span>
      <span class="row-time-readonly">${fmtTime(line.time)}</span>
      <input class="row-text" type="text" value="${escHtml(line.text)}" placeholder="Tekstregel…" data-i="${i}" />
      <button class="row-del" title="Verwijder regel" data-i="${i}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('.row-text').forEach(inp => {
    inp.addEventListener('input', () => { lines[+inp.dataset.i].text = inp.value; });
  });
  list.querySelectorAll('.row-del').forEach(btn => {
    btn.addEventListener('click', () => {
      lines.splice(+btn.dataset.i, 1);
      renderLyricsList();
      renderTimingList();
    });
  });

  // Pager
  const pager = document.getElementById('lyricsPager');
  if (totalPages > 1) {
    pager.hidden = false;
    document.getElementById('lyricsPagerLabel').textContent = `${lyricsPage + 1} / ${totalPages}`;
    pager.querySelector('[data-dir="-1"]').disabled = lyricsPage === 0;
    pager.querySelector('[data-dir="1"]').disabled  = lyricsPage >= totalPages - 1;
  } else {
    pager.hidden = true;
  }
}

// ── Tab 3: Timing-editor (compact met time controls) ─────────
function renderTimingList() {
  const list = document.getElementById('timingRows');
  const countEl = document.getElementById('timingLineCount');
  if (!list) return;
  if (countEl) countEl.textContent = lines.length;

  if (!currentSong) {
    list.innerHTML = `<div class="adm-lyrics-empty">Selecteer eerst een lied.</div>`;
    document.getElementById('timingPager').hidden = true;
    return;
  }

  if (lines.length === 0) {
    list.innerHTML = `<div class="adm-lyrics-empty">Nog geen regels. Voeg ze toe in tab "Songtekst".</div>`;
    document.getElementById('timingPager').hidden = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(lines.length / TIMING_PER_PAGE));
  if (timingPage >= totalPages) timingPage = totalPages - 1;
  if (timingPage < 0) timingPage = 0;
  const start = timingPage * TIMING_PER_PAGE;
  const slice = lines.slice(start, start + TIMING_PER_PAGE);

  list.innerHTML = '';
  slice.forEach((line, idxInPage) => {
    const i = start + idxInPage;
    const row = document.createElement('div');
    row.className = 'adm-timing-row';
    row.dataset.lineIndex = i;
    row.innerHTML = `
      <span class="row-num">${i + 1}</span>
      <div class="row-time-controls">
        <button class="time-btn" data-i="${i}" data-d="-1"  title="-1s">−1</button>
        <button class="time-btn" data-i="${i}" data-d="-0.5" title="-½s">−½</button>
        <input  class="time-input" type="number" step="0.1" min="0"
                value="${parseFloat(line.time).toFixed(2)}" data-i="${i}" />
        <button class="time-btn" data-i="${i}" data-d="0.5" title="+½s">+½</button>
        <button class="time-btn" data-i="${i}" data-d="1"   title="+1s">+1</button>
        <button class="snap-btn" data-i="${i}" title="Pak huidige videotijd">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
          </svg>
        </button>
      </div>
      <span class="row-text-readonly" title="${escHtml(line.text)}">${escHtml(line.text || '(leeg)')}</span>
      <button class="row-preview" data-i="${i}" title="Spring naar dit moment">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </button>
      <button class="row-del" title="Verwijder regel" data-i="${i}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i, d = parseFloat(btn.dataset.d);
      lines[i].time = Math.max(0, parseFloat(lines[i].time) + d);
      renderTimingList();
    });
  });
  list.querySelectorAll('.time-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = +inp.dataset.i;
      lines[i].time = Math.max(0, parseFloat(inp.value) || 0);
      renderTimingList();
    });
  });
  list.querySelectorAll('.snap-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      const t = ytPlayer?.getCurrentTime?.() ?? lastTimeSec;
      lines[i].time = parseFloat(t.toFixed(2));
      renderTimingList();
    });
  });
  list.querySelectorAll('.row-preview').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      if (ytPlayer?.seekTo) ytPlayer.seekTo(lines[i].time, true);
      if (ytPlayer?.playVideo) ytPlayer.playVideo();
    });
  });
  list.querySelectorAll('.row-del').forEach(btn => {
    btn.addEventListener('click', () => {
      lines.splice(+btn.dataset.i, 1);
      renderTimingList();
      renderLyricsList();
    });
  });

  // Pager
  const pager = document.getElementById('timingPager');
  if (totalPages > 1) {
    pager.hidden = false;
    document.getElementById('timingPagerLabel').textContent = `${timingPage + 1} / ${totalPages}`;
    pager.querySelector('[data-dir="-1"]').disabled = timingPage === 0;
    pager.querySelector('[data-dir="1"]').disabled  = timingPage >= totalPages - 1;
  } else {
    pager.hidden = true;
  }
}

function highlightActiveTimingRow(t) {
  const list = document.getElementById('timingRows');
  if (!list || activeTab !== 'timing') return;
  let activeIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= t) activeIndex = i; else break;
  }
  list.querySelectorAll('.adm-timing-row').forEach(row => {
    row.classList.toggle('is-active', +row.dataset.lineIndex === activeIndex);
  });
}

// ── Songtekst opslaan ────────────────────────────────────────
async function saveLyrics() {
  if (!currentSong?.id) { toast('Sla eerst het lied op', false); return; }
  await db.from('meezingvideo_lyrics').delete().eq('song_id', currentSong.id);
  if (lines.length === 0) { toast('Songtekst opgeslagen (leeg)'); return; }
  const rows = lines.map(l => ({
    song_id: currentSong.id,
    time: parseFloat(l.time),
    text: l.text
  }));
  const { error } = await db.from('meezingvideo_lyrics').insert(rows);
  if (error) { toast('Fout: ' + error.message, false); return; }
  toast('Songtekst opgeslagen ✓');
}

// ── Songtekst opzoeken via AI (Claude, server-side) ──────────
function setSearchStatus(text, type = 'info') {
  const el = document.getElementById('searchStatus');
  if (!el) return;
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = text;
  el.dataset.type = type; // info|error|success
}

async function runAutoSearch() {
  const q = (document.getElementById('searchQuery')?.value || '').trim();
  if (!q) { toast('Vul eerst titel + artiest in', false); return; }

  const result = document.getElementById('lyricsResult');
  const btn    = document.getElementById('searchBtn');
  btn.disabled = true;
  setSearchStatus('Claude zoekt de tekst op…', 'info');

  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) throw new Error('Niet ingelogd — log opnieuw in');

    const res = await fetch('/api/find-lyrics?q=' + encodeURIComponent(q), {
      headers: { 'Authorization': 'Bearer ' + session.access_token }
    });

    let json;
    try { json = await res.json(); }
    catch { throw new Error('Server gaf geen geldige JSON terug (status ' + res.status + ')'); }

    if (!res.ok) throw new Error(json.error || 'Onbekende fout (status ' + res.status + ')');
    if (!json.lyrics) throw new Error('AI gaf geen tekst terug');

    result.value = json.lyrics;
    setSearchStatus(`Gevonden via Claude (${json.model || 'AI'}). Bekijk en pas eventueel aan vóór importeren.`, 'success');
  } catch (e) {
    setSearchStatus(e.message + ' — of zoek handmatig via de links hieronder.', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Importeer gevonden / geplakte songtekst ──────────────────
function importPastedLyrics() {
  if (!currentSong) { toast('Selecteer eerst een lied', false); return; }
  const raw = document.getElementById('lyricsResult')?.value || '';
  const parsed = [];

  raw.split('\n').forEach(ln => {
    ln = ln.replace(/\s+/g, ' ').trim();
    if (!ln) return;
    if (/^\[.*\]$/.test(ln)) return;          // [Refrein]
    if (/^\(.*\)$/.test(ln)) return;          // (2x)
    // Sla disclaimer/credits van Songteksten.net over
    if (/songteksten\.net|alle rechten|toestemming|stichting femu/i.test(ln)) return;
    if (/laatst gewijzigd/i.test(ln)) return;

    const m = ln.match(/^(?:(\d+):)?(\d+(?:[.,]\d+)?)\s+(.+)$/);
    if (m && m[3] && m[3].length > 1 && /[a-zA-Z]/.test(m[3])) {
      const mins = m[1] ? parseInt(m[1]) : 0;
      const secs = parseFloat(m[2].replace(',', '.'));
      parsed.push({ time: mins * 60 + secs, text: m[3].trim() });
    } else {
      parsed.push({ time: 0, text: ln });
    }
  });

  if (parsed.length === 0) { toast('Geen tekst gevonden om te importeren', false); return; }
  lines.push(...parsed);
  if (parsed.some(p => p.time > 0)) sortLines();
  document.getElementById('lyricsResult').value = '';
  setSearchStatus('');
  renderLyricsList();
  renderTimingList();
  toast(`${parsed.length} regel${parsed.length === 1 ? '' : 's'} geïmporteerd → zet de tijden in tab Timing`);
}

// ── Pre-fill zoekveld + fallback-links ───────────────────────
function updateSearchQuery() {
  const q = document.getElementById('searchQuery');
  if (!q) return;
  const txt = currentSong ? [currentSong.title, currentSong.artist].filter(Boolean).join(' ') : '';
  q.value = txt;
  // Update handmatige links
  const enc = encodeURIComponent(txt);
  const nl  = document.getElementById('manualNl');
  const net = document.getElementById('manualNet');
  const gg  = document.getElementById('manualGoogle');
  if (nl)  nl.href  = `https://www.google.com/search?q=${encodeURIComponent('site:songteksten.nl ' + txt)}`;
  if (net) net.href = `https://www.google.com/search?q=${encodeURIComponent('site:songteksten.net ' + txt)}`;
  if (gg)  gg.href  = `https://www.google.com/search?q=${encodeURIComponent(txt + ' songtekst')}`;
}

// ── Shift-all timing ─────────────────────────────────────────
function initShiftControls() {
  const shiftVal = () => parseFloat(document.getElementById('shiftSeconds')?.value) || 0;
  document.getElementById('shiftEarlierBtn')?.addEventListener('click', () => {
    const d = shiftVal();
    lines.forEach(l => { l.time = Math.max(0, parseFloat(l.time) - d); });
    renderTimingList(); renderLyricsList();
    toast(`Alle regels ${d}s eerder`);
  });
  document.getElementById('shiftLaterBtn')?.addEventListener('click', () => {
    const d = shiftVal();
    lines.forEach(l => { l.time = parseFloat(l.time) + d; });
    renderTimingList(); renderLyricsList();
    toast(`Alle regels ${d}s later`);
  });
}

// ── Auth ─────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (session) showAdmin(); else showLogin();
  db.auth.onAuthStateChange((_, session) => {
    if (session) showAdmin(); else showLogin();
  });
}

function showLogin() {
  document.getElementById('loginView').hidden = false;
  document.getElementById('adminView').hidden = true;
  document.getElementById('logoutBtn').hidden = true;
}

function showAdmin() {
  document.getElementById('loginView').hidden = true;
  document.getElementById('adminView').hidden = false;
  document.getElementById('logoutBtn').hidden = false;
  loadSongs();
}

// ── DOM ready ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  init();

  // Login
  document.getElementById('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email    = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const btn      = document.getElementById('loginSubmit');
    btn.disabled = true; btn.textContent = 'Bezig…';
    const { error } = await db.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = 'Inloggen';
    if (error) toast('Inloggen mislukt: ' + error.message, false);
  });
  document.getElementById('logoutBtn')?.addEventListener('click', () => db.auth.signOut());

  // Tab buttons
  document.querySelectorAll('.adm-tab').forEach(t => {
    t.addEventListener('click', () => {
      if (t.disabled) return;
      switchTab(t.dataset.tab);
    });
  });

  // Song filter
  document.getElementById('songFilter')?.addEventListener('input', () => {
    songPage = 0;
    renderSongGrid();
  });

  // Song actions
  document.getElementById('newSongBtn')?.addEventListener('click', newSong);
  document.getElementById('saveSongBtn')?.addEventListener('click', saveSong);
  document.getElementById('deleteSongBtn')?.addEventListener('click', deleteSong);

  // Lyrics actions
  document.getElementById('addLineBtn')?.addEventListener('click', () => {
    if (!currentSong) { toast('Selecteer eerst een lied', false); return; }
    const t = ytPlayer?.getCurrentTime?.() ?? lastTimeSec;
    lines.push({ time: parseFloat(t.toFixed(2)), text: '' });
    sortLines();
    // ga naar laatste pagina
    lyricsPage = Math.floor((lines.length - 1) / LYRICS_PER_PAGE);
    renderLyricsList();
    renderTimingList();
  });
  document.getElementById('captureTimeBtn')?.addEventListener('click', () => {
    if (!currentSong) { toast('Selecteer eerst een lied', false); return; }
    const t = ytPlayer?.getCurrentTime?.() ?? lastTimeSec;
    lines.push({ time: parseFloat(t.toFixed(2)), text: '' });
    sortLines();
    timingPage = Math.floor((lines.length - 1) / TIMING_PER_PAGE);
    renderTimingList();
    renderLyricsList();
    toast(`Regel toegevoegd op ${t.toFixed(2)}s`);
  });
  document.getElementById('saveLyricsBtn')?.addEventListener('click', saveLyrics);
  document.getElementById('saveLyricsBtn2')?.addEventListener('click', saveLyrics);
  document.getElementById('sortLinesBtn')?.addEventListener('click', () => {
    sortLines();
    renderTimingList();
    renderLyricsList();
    toast('Regels gesorteerd op tijd');
  });

  // Songtekst zoeken (auto) + importeren
  document.getElementById('searchForm')?.addEventListener('submit', e => {
    e.preventDefault();
    runAutoSearch();
  });
  document.getElementById('importLyricsBtn')?.addEventListener('click', importPastedLyrics);

  // Shift-all
  initShiftControls();

  // Pagers
  document.getElementById('songPager')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-dir]'); if (!btn) return;
    songPage += parseInt(btn.dataset.dir, 10);
    renderSongGrid();
  });
  document.getElementById('lyricsPager')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-dir]'); if (!btn) return;
    lyricsPage += parseInt(btn.dataset.dir, 10);
    renderLyricsList();
  });
  document.getElementById('timingPager')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-dir]'); if (!btn) return;
    timingPage += parseInt(btn.dataset.dir, 10);
    renderTimingList();
  });
});
