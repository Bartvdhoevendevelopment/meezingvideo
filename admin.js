/* ============================================================
   admin.js  —  Meezingvideo beheermodule (V2, tab-based)
   ============================================================ */

// Mobiel-/tablet-block: beheer is alleen op de computer beschikbaar.
// Combinatie van smalle viewport + touch-device geeft de meest betrouwbare detectie.
(function blockOnMobile() {
  const isNarrow = window.matchMedia('(max-width: 900px)').matches;
  const isTouchOnly = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (!(isNarrow || isTouchOnly)) return;
  document.addEventListener('DOMContentLoaded', () => {
    const block = document.getElementById('mobileBlock');
    const topbar = document.querySelector('.adm-topbar');
    const login  = document.getElementById('loginView');
    const view   = document.getElementById('adminView');
    if (block) block.hidden = false;
    if (topbar) topbar.hidden = true;
    if (login)  login.hidden  = true;
    if (view)   view.hidden   = true;
    // Verkort hier ook: niet meer doorgaan met de rest van admin.js
    document.body.classList.add('admin-blocked');
  });
  // Stop verdere initialisatie (Supabase-client etc) — niets meer doen op deze pagina
  window.__MEEZING_BLOCKED__ = true;
})();

if (window.__MEEZING_BLOCKED__) {
  // Niets meer doen — de mobiel-block-overlay is zichtbaar
} else {

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
let syncCursor    = 0;     // spatiebalk-workflow: welke regel als volgende
let activeTab     = 'library';
let ytPlayer      = null;
let ytPreview     = null;
let ytReady       = false;
let timeInterval  = null;
let previewTimeInterval = null;
let lastTimeSec   = 0;
let lastPreviewTimeSec = 0;
let loadedVideoId = null;
let loadedPreviewVideoId = null;

const SONGS_PER_PAGE   = 9999; // alles op één scrollbare lijst — geen paginatie
const LYRICS_PER_PAGE  = 9;
const TIMING_PER_PAGE  = 8;

// ── YouTube IFrame API ───────────────────────────────────────
window.onYouTubeIframeAPIReady = function () { ytReady = true; };

function initYT(videoId) {
  if (!videoId) return;
  if (ytPlayer) {
    if (loadedVideoId !== videoId && ytPlayer.loadVideoById) {
      ytPlayer.loadVideoById(videoId);
      loadedVideoId = videoId;
    }
    return;
  }
  if (!ytReady) { setTimeout(() => initYT(videoId), 200); return; }
  ytPlayer = new YT.Player('adminYtPlayer', {
    height: '100%', width: '100%',
    videoId,
    playerVars: { rel: 0, modestbranding: 1 },
    events: {
      onReady: () => {
        loadedVideoId = videoId;
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
  loadedVideoId = videoId;
}

function initYTPreview(videoId) {
  if (!videoId) return;
  if (ytPreview) {
    if (loadedPreviewVideoId !== videoId && ytPreview.loadVideoById) {
      ytPreview.loadVideoById(videoId);
      loadedPreviewVideoId = videoId;
    }
    return;
  }
  if (!ytReady) { setTimeout(() => initYTPreview(videoId), 200); return; }
  ytPreview = new YT.Player('previewYtPlayer', {
    height: '100%', width: '100%',
    videoId,
    playerVars: { rel: 0, modestbranding: 1 },
    events: {
      onReady: () => {
        loadedPreviewVideoId = videoId;
        clearInterval(previewTimeInterval);
        previewTimeInterval = setInterval(() => {
          if (ytPreview?.getCurrentTime) {
            lastPreviewTimeSec = ytPreview.getCurrentTime();
            highlightActivePreviewLine(lastPreviewTimeSec);
          }
        }, 200);
      }
    }
  });
  loadedPreviewVideoId = videoId;
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
  if (name === 'timing' && currentSong?.youtube_id) initYT(currentSong.youtube_id);
  if (name === 'preview' && currentSong?.youtube_id) initYTPreview(currentSong.youtube_id);
  if (name === 'lyrics') renderLyricsList();
  if (name === 'timing') renderTimingList();
  if (name === 'preview') renderPreview();
}

function setTabsEnabled(songSelected) {
  ['lyrics', 'timing', 'preview'].forEach(tab => {
    const btn = document.querySelector(`.adm-tab[data-tab="${tab}"]`);
    if (btn) btn.disabled = !songSelected;
  });
}

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

// ── E-mail → naam mapping ────────────────────────────────────
const USER_NAME_MAP = {
  'bartvdhoeven@live.nl': 'Bart',
  'keesvdhoeven@live.nl': 'Kees'
};
function displayName(email) {
  if (!email) return '';
  const lower = String(email).toLowerCase().trim();
  if (USER_NAME_MAP[lower]) return USER_NAME_MAP[lower];
  const prefix = lower.split('@')[0];
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}
async function currentUserEmail() {
  try {
    const { data: { user } } = await db.auth.getUser();
    return user?.email || null;
  } catch { return null; }
}

// ── Songenlijst laden ────────────────────────────────────────
async function loadSongs() {
  const { data, error } = await db.from('meezingvideo_songs')
    .select('id,title,artist,youtube_id,description,created_by,updated_by').order('title');
  if (error) { toast('Fout bij laden liederen: ' + error.message, false); return; }
  allSongs = data || [];
  renderSongGrid();
}

function getFilteredSongs() {
  const q = (document.getElementById('songFilter')?.value || '').toLowerCase();
  if (!q) return allSongs;
  return allSongs.filter(s =>
    (s.title || '').toLowerCase().includes(q) ||
    (s.artist || '').toLowerCase().includes(q) ||
    displayName(s.created_by).toLowerCase().includes(q) ||
    displayName(s.updated_by).toLowerCase().includes(q)
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
      const creator = displayName(song.created_by);
      const editor  = displayName(song.updated_by);
      let byline = '';
      if (creator && editor && creator !== editor) byline = `${creator} · bewerkt door ${editor}`;
      else if (creator) byline = `door ${creator}`;
      btn.innerHTML = `
        <div class="adm-song-card-text">
          <div class="adm-song-card-title">${escHtml(song.title)}</div>
          <div class="adm-song-card-artist">${escHtml(song.artist || '—')}${byline ? ' <span class="adm-song-card-by">· ' + escHtml(byline) + '</span>' : ''}</div>
        </div>
        <svg class="adm-song-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <path d="M9 6l6 6-6 6"/>
        </svg>
      `;
      btn.addEventListener('click', () => selectSong(song.id));
      grid.appendChild(btn);
    });
  }

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
  syncCursor = 0;

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
  syncCursor = 0;
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
  setTabsEnabled(false);
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

  const email = await currentUserEmail();
  const payload = { title, artist, youtube_id, description, updated_by: email };
  let songId;

  if (currentSong?.id) {
    const { error } = await db.from('meezingvideo_songs').update(payload).eq('id', currentSong.id);
    if (error) { toast('Fout: ' + error.message, false); return; }
    songId = currentSong.id;
  } else {
    payload.created_by = email;
    const { data, error } = await db.from('meezingvideo_songs').insert(payload).select().single();
    if (error) { toast('Fout: ' + error.message, false); return; }
    songId = data.id;
  }

  currentSong = { ...payload, id: songId };
  updateSongContext();
  setTabsEnabled(true);
  document.getElementById('deleteSongBtn').hidden = false;
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

// ── Regel-acties: omhoog/omlaag/kopieer ──────────────────────
function moveLine(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= lines.length) return;
  const tmp = lines[i]; lines[i] = lines[j]; lines[j] = tmp;
  if (activeTab === 'lyrics') lyricsPage = Math.floor(j / LYRICS_PER_PAGE);
  if (activeTab === 'timing') timingPage = Math.floor(j / TIMING_PER_PAGE);
  renderLyricsList();
  renderTimingList();
}

function duplicateLine(i) {
  if (i < 0 || i >= lines.length) return;
  const copy = { time: lines[i].time, text: lines[i].text };
  lines.splice(i + 1, 0, copy);
  if (activeTab === 'lyrics') lyricsPage = Math.floor((i + 1) / LYRICS_PER_PAGE);
  if (activeTab === 'timing') timingPage = Math.floor((i + 1) / TIMING_PER_PAGE);
  renderLyricsList();
  renderTimingList();
}

// ── SVG icons voor acties (DRY) ──────────────────────────────
const SVG_UP   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>';
const SVG_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const SVG_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const SVG_DEL  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
const SVG_GRIP = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';

function gripHtml(i) {
  return `<span class="row-grip" draggable="true" data-i="${i}" title="Sleep om te verplaatsen">${SVG_GRIP}</span>`;
}

function numHtml(i) {
  return `<span class="row-num">${i + 1}</span>`;
}

// ── Drag-and-drop voor regels ────────────────────────────────
let dragSrcIdx = null;

function handleDragStart(e) {
  const handle = e.target.closest('.row-grip');
  if (!handle) return;
  dragSrcIdx = +handle.dataset.i;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragSrcIdx));
  const row = handle.closest('.adm-lyrics-row, .adm-timing-row');
  if (row) setTimeout(() => row.classList.add('dragging'), 0);
}

function clearDropIndicators() {
  document.querySelectorAll('.drop-before, .drop-after').forEach(r => {
    r.classList.remove('drop-before', 'drop-after');
  });
}

function handleDragEnd(e) {
  dragSrcIdx = null;
  document.querySelectorAll('.dragging').forEach(r => r.classList.remove('dragging'));
  clearDropIndicators();
}

function handleDragOver(e) {
  if (dragSrcIdx === null) return;
  // Altijd preventDefault binnen de lijst, ook als cursor in de tussenruimte (gap) zit
  // — anders blokkeert de browser de drop wanneer je 'm vlak boven/onder een regel loslaat
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.target.closest('.adm-lyrics-row, .adm-timing-row');
  if (!row) return; // geen rij onder cursor — laat eerdere indicator staan

  // Bepaal of cursor in bovenste of onderste helft van de regel is
  const rect = row.getBoundingClientRect();
  const isUpperHalf = (e.clientY - rect.top) < rect.height / 2;

  // Reset alle indicators, zet alleen op deze regel
  clearDropIndicators();
  row.classList.add(isUpperHalf ? 'drop-before' : 'drop-after');
}

function handleDrop(e) {
  if (dragSrcIdx === null) return;
  e.preventDefault();
  const row = document.querySelector('.drop-before, .drop-after')
           || e.target.closest('.adm-lyrics-row, .adm-timing-row');
  if (!row) { handleDragEnd(); return; }
  const targetIdx = +row.dataset.i;
  if (Number.isNaN(targetIdx)) { handleDragEnd(); return; }

  const position = row.classList.contains('drop-after') ? 'after' : 'before';
  const src = dragSrcIdx;
  dragSrcIdx = null;
  document.querySelectorAll('.dragging').forEach(r => r.classList.remove('dragging'));
  clearDropIndicators();
  reorderLine(src, targetIdx, position);
}

function reorderLine(src, dst, position = 'before') {
  if (src < 0 || src >= lines.length || dst < 0 || dst >= lines.length) return;
  // Bereken insert-index (vóór of na het doel)
  let insertAt = position === 'after' ? dst + 1 : dst;
  if (src === insertAt || src + 1 === insertAt) return; // geen verandering
  const item = lines.splice(src, 1)[0];
  if (src < insertAt) insertAt--; // compenseer voor de splice hierboven
  lines.splice(insertAt, 0, item);
  // Houd de regel zichtbaar op de juiste pagina
  if (activeTab === 'lyrics') lyricsPage = Math.floor(insertAt / LYRICS_PER_PAGE);
  if (activeTab === 'timing') timingPage = Math.floor(insertAt / TIMING_PER_PAGE);
  renderLyricsList();
  renderTimingList();
}

function actionsHtml(i) {
  return `<div class="row-actions">
    <button class="row-act row-up"   title="Verplaats omhoog" data-i="${i}" ${i === 0 ? 'disabled' : ''}>${SVG_UP}</button>
    <button class="row-act row-down" title="Verplaats omlaag" data-i="${i}" ${i === lines.length - 1 ? 'disabled' : ''}>${SVG_DOWN}</button>
    <button class="row-act row-copy" title="Kopieer regel eronder" data-i="${i}">${SVG_COPY}</button>
    <button class="row-act row-del"  title="Verwijder regel" data-i="${i}">${SVG_DEL}</button>
  </div>`;
}

function wireRowActions(list) {
  list.querySelectorAll('.row-up').forEach(btn => btn.addEventListener('click', () => moveLine(+btn.dataset.i, -1)));
  list.querySelectorAll('.row-down').forEach(btn => btn.addEventListener('click', () => moveLine(+btn.dataset.i, +1)));
  list.querySelectorAll('.row-copy').forEach(btn => btn.addEventListener('click', () => duplicateLine(+btn.dataset.i)));
  list.querySelectorAll('.row-del').forEach(btn => btn.addEventListener('click', () => {
    lines.splice(+btn.dataset.i, 1);
    renderLyricsList();
    renderTimingList();
  }));
}

// ── Tab 2: Songtekst-editor (compact, tekst-focus) ───────────
function renderLyricsList() {
  const list = document.getElementById('lyricsList');
  const count = document.getElementById('lineCount');
  if (!list) return;
  count.textContent = lines.length;

  if (!currentSong) {
    list.innerHTML = `<div class="adm-lyrics-empty"><p>Selecteer eerst een lied in tab <strong>Liedbeheer</strong>.</p></div>`;
    document.getElementById('lyricsPager').hidden = true;
    return;
  }

  if (lines.length === 0) {
    list.innerHTML = `<div class="adm-lyrics-empty"><p>Nog geen regels. Klik op <strong>+&nbsp;Regel</strong>&nbsp;of zoek de tekst online (paneel rechts).</p></div>`;
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
    row.dataset.i = i;
    row.innerHTML = `
      ${gripHtml(i)}
      ${numHtml(i)}
      <input class="row-text" type="text" value="${escHtml(line.text)}" placeholder="Tekstregel…" data-i="${i}" />
      ${actionsHtml(i)}
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('.row-text').forEach(inp => {
    inp.addEventListener('input', () => { lines[+inp.dataset.i].text = inp.value; });
  });
  wireRowActions(list);

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
    list.innerHTML = `<div class="adm-lyrics-empty"><p>Selecteer eerst een lied.</p></div>`;
    document.getElementById('timingPager').hidden = true;
    return;
  }

  if (lines.length === 0) {
    list.innerHTML = `<div class="adm-lyrics-empty"><p>Nog geen regels. Voeg ze toe in tab <strong>Songtekst</strong>.</p></div>`;
    document.getElementById('timingPager').hidden = true;
    return;
  }

  // Sync-lijst is één lange scrollbare lijst — geen paginatie
  const start = 0;
  const slice = lines;

  list.innerHTML = '';
  slice.forEach((line, idxInPage) => {
    const i = start + idxInPage;
    const row = document.createElement('div');
    row.className = 'adm-timing-row' + (i === syncCursor ? ' is-cursor' : '');
    row.dataset.lineIndex = i;
    row.dataset.i = i;
    row.innerHTML = `
      ${gripHtml(i)}
      ${numHtml(i)}
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
      ${actionsHtml(i)}
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
      // Klik op snap-knop = cursor verzetten naar volgende regel + meescrollen
      syncCursor = Math.min(i + 1, lines.length);
      const focusIndex = syncCursor < lines.length ? syncCursor : i;
      btn.blur();
      renderTimingList();
      scrollCursorIntoView(focusIndex);
    });
  });
  list.querySelectorAll('.row-preview').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      if (ytPlayer?.seekTo) ytPlayer.seekTo(lines[i].time, true);
      if (ytPlayer?.playVideo) ytPlayer.playVideo();
      // Zet de spatiebalk-cursor op deze regel, zodat de volgende spatie hier landt
      syncCursor = i;
      // Haal focus weg van de knop, anders re-triggert spatiebalk de knop ipv door te gaan
      btn.blur();
      renderTimingList();
      scrollCursorIntoView(i);
    });
  });
  wireRowActions(list);

  // Klik ergens op de regel (behalve op een knop/input/grip) = cursor naar deze regel
  list.querySelectorAll('.adm-timing-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('button, input, .row-grip')) return;
      const i = +row.dataset.lineIndex;
      if (i === syncCursor) return;
      syncCursor = i;
      // Update DOM zonder full re-render zodat scrollpositie en video ongemoeid blijven
      list.querySelectorAll('.adm-timing-row').forEach(r => {
        r.classList.toggle('is-cursor', +r.dataset.lineIndex === syncCursor);
      });
    });
  });

  // Geen paginatie meer in Sync — alles scrollt
  const pager = document.getElementById('timingPager');
  if (pager) pager.hidden = true;
}

function scrollCursorIntoView(index) {
  // Wacht tot na de render-frame zodat de regel daadwerkelijk in het DOM staat
  requestAnimationFrame(() => {
    const row = document.querySelector(`.adm-timing-row[data-line-index="${index}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ── Preview-tab (stap 4) ─────────────────────────────────────
function renderPreview() {
  const list = document.getElementById('previewLyrics');
  if (!list) return;
  if (!currentSong || lines.length === 0) {
    list.innerHTML = `<div class="adm-preview-empty">Geen regels — voeg ze toe in tab <strong>Songtekst</strong>.</div>`;
    return;
  }
  list.innerHTML = '';
  lines.forEach((line, i) => {
    const el = document.createElement('div');
    el.className = 'adm-preview-line';
    el.dataset.lineIndex = i;
    el.innerHTML = `
      <div class="pv-tune">
        <button class="pv-tune-btn" data-i="${i}" data-d="-0.5" title="½s eerder">−½s</button>
      </div>
      <div class="pv-text">${escHtml(line.text || '(leeg)')}</div>
      <div class="pv-tune">
        <button class="pv-tune-btn" data-i="${i}" data-d="0.5" title="½s later">+½s</button>
      </div>
      <div class="pv-time">${parseFloat(line.time || 0).toFixed(2)}s</div>
    `;
    list.appendChild(el);
  });
  // Finetune-knoppen: ±0.5s
  list.querySelectorAll('.pv-tune-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      const d = parseFloat(btn.dataset.d);
      lines[i].time = Math.max(0, parseFloat(lines[i].time || 0) + d);
      btn.blur();
      renderPreview();
    });
  });
  highlightActivePreviewLine(lastPreviewTimeSec);
}

function highlightActivePreviewLine(t) {
  const list = document.getElementById('previewLyrics');
  if (!list || activeTab !== 'preview') return;
  const activeIndex = findActiveLineIndex(t);
  let didChangeActive = false;
  list.querySelectorAll('.adm-preview-line').forEach(el => {
    const i = +el.dataset.lineIndex;
    const wasActive = el.classList.contains('active');
    const isActive = i === activeIndex;
    el.classList.toggle('active', isActive);
    el.classList.toggle('passed', activeIndex >= 0 && i < activeIndex);
    if (isActive && !wasActive) didChangeActive = true;
  });
  // Scroll de actieve regel midden in beeld
  if (didChangeActive && activeIndex >= 0) {
    scrollPreviewLineIntoView(activeIndex);
  }
}

function scrollPreviewLineIntoView(index) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`.adm-preview-line[data-line-index="${index}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function applyPreviewVideoHeight(heightPx) {
  const frame = document.querySelector('.adm-preview-frame');
  if (!frame) return;
  // Begrens tussen 140px en 70% van het scherm
  const h = Math.max(140, Math.min(window.innerHeight * 0.7, heightPx));
  frame.style.maxHeight = h + 'px';
  frame.style.width = `min(100%, ${h * 16 / 9}px)`;
}

function initPreviewResize() {
  const handle = document.getElementById('previewResize');
  const frame  = document.querySelector('.adm-preview-frame');
  if (!handle || !frame) return;

  // Herstel opgeslagen hoogte
  const saved = parseFloat(localStorage.getItem('mzv_previewVideoHeight'));
  if (saved && saved > 100) applyPreviewVideoHeight(saved);

  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  const onMove = e => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    const newH = startHeight + dy;
    applyPreviewVideoHeight(newH);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Bewaar de huidige hoogte
    const cur = frame.getBoundingClientRect().height;
    localStorage.setItem('mzv_previewVideoHeight', String(Math.round(cur)));
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  handle.addEventListener('mousedown', e => {
    dragging = true;
    handle.classList.add('dragging');
    startY = e.clientY;
    startHeight = frame.getBoundingClientRect().height;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });

  // Dubbel-klik = reset naar default
  handle.addEventListener('dblclick', () => {
    frame.style.maxHeight = '';
    frame.style.width = '';
    localStorage.removeItem('mzv_previewVideoHeight');
  });
}

function findActiveLineIndex(t) {
  // Regel met de grootste tijd <= huidige tijd (ook met ongesorteerde regels)
  let activeIndex = -1;
  let bestTime = -Infinity;
  for (let i = 0; i < lines.length; i++) {
    const lineTime = parseFloat(lines[i].time);
    if (!Number.isNaN(lineTime) && lineTime <= t && lineTime > bestTime) {
      bestTime = lineTime;
      activeIndex = i;
    }
  }
  return activeIndex;
}

function highlightActiveTimingRow(t) {
  const list = document.getElementById('timingRows');
  if (!list || activeTab !== 'timing') return;
  // Blauwe cursor automatisch mee laten lopen met de videotijd.
  // Alleen vooruit: zodra de tijd voorbij de regel-na-de-cursor komt, schuift
  // de cursor mee. Dat voorkomt geflap met de spatiebalk (die zet 'm op i+1
  // terwijl de videotijd nog op i staat).
  const activeIndex = findActiveLineIndex(t);
  if (activeIndex > syncCursor) {
    syncCursor = activeIndex;
    list.querySelectorAll('.adm-timing-row').forEach(row => {
      row.classList.toggle('is-cursor', +row.dataset.lineIndex === syncCursor);
    });
    scrollCursorIntoView(syncCursor);
  }
  // Eventuele oranje active-classes opruimen (uit-gezet sinds tab 4)
  list.querySelectorAll('.adm-timing-row.is-active').forEach(row => {
    row.classList.remove('is-active');
  });
}

// ── Songtekst opslaan ────────────────────────────────────────
let _savingLyrics = false;
async function saveLyrics() {
  if (!currentSong?.id) { toast('Sla eerst het lied op', false); return; }
  if (_savingLyrics) return;            // voorkom dubbele save
  // Snapshot maken: nooit op een leeg lines-array deleten zonder duidelijke
  // bevestiging. Beschermt tegen race-condities die regels zouden wissen.
  const snapshot = lines.map(l => ({
    time: parseFloat(l.time) || 0,
    text: l.text || ''
  }));
  if (snapshot.length === 0) {
    if (!confirm('Er staan geen regels in deze sectie — alle bestaande tijden voor dit lied wissen?')) {
      return;
    }
  }
  _savingLyrics = true;
  try {
    // Eerst insert proberen via een tijdelijke transactie-achtige aanpak:
    // 1) bewaar bestaande DB-versie als backup
    const { data: backup } = await db.from('meezingvideo_lyrics')
      .select('song_id,time,text').eq('song_id', currentSong.id);
    // 2) delete oude regels
    const { error: delErr } = await db.from('meezingvideo_lyrics')
      .delete().eq('song_id', currentSong.id);
    if (delErr) { toast('Fout bij verwijderen: ' + delErr.message, false); return; }
    // 3) insert nieuwe regels
    if (snapshot.length > 0) {
      const rows = snapshot.map(l => ({
        song_id: currentSong.id,
        time: l.time,
        text: l.text
      }));
      const { error: insErr } = await db.from('meezingvideo_lyrics').insert(rows);
      if (insErr) {
        // Rollback: zet de oude regels terug
        if (backup && backup.length > 0) {
          await db.from('meezingvideo_lyrics').insert(backup);
        }
        toast('Fout bij opslaan, oude regels hersteld: ' + insErr.message, false);
        return;
      }
    }
    // 4) markeer wie de songtekst heeft bewerkt op het lied
    const email = await currentUserEmail();
    if (email) {
      await db.from('meezingvideo_songs').update({ updated_by: email }).eq('id', currentSong.id);
      await loadSongs();
    }
    toast(snapshot.length === 0 ? 'Songtekst opgeslagen (leeg)' : 'Songtekst opgeslagen ✓');
  } finally {
    _savingLyrics = false;
  }
}

// ── Songtekst opzoeken via /api/find-lyrics ──────────────────
function setSearchStatus(text, type = 'info') {
  const el = document.getElementById('searchStatus');
  if (!el) return;
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = text;
  el.dataset.type = type;
}

async function runAutoSearch() {
  const q = (document.getElementById('searchQuery')?.value || '').trim();
  if (!q) { toast('Vul eerst titel + artiest in', false); return; }

  const result = document.getElementById('lyricsResult');
  const btn    = document.getElementById('searchBtn');
  btn.disabled = true;
  setSearchStatus('Bezig met zoeken…', 'info');

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
    if (!json.lyrics) throw new Error('Geen tekst gevonden');

    result.value = json.lyrics;
    const label = json.provider || (json.source ? (() => { try { return new URL(json.source).hostname; } catch { return 'bron'; } })() : 'bron');
    setSearchStatus(`Gevonden via ${label}. Bekijk en pas eventueel aan vóór importeren.`, 'success');
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
    if (/^\[.*\]$/.test(ln)) return;
    if (/^\(.*\)$/.test(ln)) return;
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
  toast(`${parsed.length} regel${parsed.length === 1 ? '' : 's'} geïmporteerd → zet de tijden in tab Sync`);
}

function updateSearchQuery() {
  const q = document.getElementById('searchQuery');
  if (!q) return;
  const txt = currentSong ? [currentSong.title, currentSong.artist].filter(Boolean).join(' ') : '';
  q.value = txt;
  const dbk  = document.getElementById('manualDbk');
  const sela = document.getElementById('manualSela');
  const net  = document.getElementById('manualNet');
  const gg   = document.getElementById('manualGoogle');
  if (dbk)  dbk.href  = `https://www.google.com/search?q=${encodeURIComponent('site:dagelijksebroodkruimels.nl ' + txt)}`;
  if (sela) sela.href = `https://www.google.com/search?q=${encodeURIComponent('site:sela.nl ' + txt)}`;
  if (net)  net.href  = `https://www.google.com/search?q=${encodeURIComponent('site:songteksten.net ' + txt)}`;
  if (gg)   gg.href   = `https://www.google.com/search?q=${encodeURIComponent(txt + ' songtekst')}`;
}

// ── Shift-all timing ─────────────────────────────────────────
function initShiftControls() {
  const shiftVal = () => parseFloat(document.getElementById('shiftSeconds')?.value) || 0;
  document.getElementById('shiftEarlierBtn')?.addEventListener('click', () => {
    const d = shiftVal();
    lines.forEach(l => { l.time = Math.max(0, parseFloat(l.time) - d); });
    renderLyricsList();
    renderTimingList();
    toast(`Alle tijden ${d}s eerder`);
  });
  document.getElementById('shiftLaterBtn')?.addEventListener('click', () => {
    const d = shiftVal();
    lines.forEach(l => { l.time = parseFloat(l.time) + d; });
    renderLyricsList();
    renderTimingList();
    toast(`Alle tijden ${d}s later`);
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

  document.getElementById('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn      = document.getElementById('loginSubmit');
    if (!email || !password) {
      toast('Vul je e-mail en wachtwoord in.', false);
      return;
    }
    btn.disabled = true; btn.textContent = 'Bezig…';
    const { error } = await db.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = 'Inloggen';
    if (error) {
      // Vertaal de Engelse Supabase-meldingen naar het Nederlands
      const msg = (error.message || '').toLowerCase();
      let dutch = 'Inloggen niet gelukt. Probeer het nog eens.';
      if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) {
        dutch = 'E-mail of wachtwoord klopt niet.';
      } else if (msg.includes('email not confirmed')) {
        dutch = 'Je e-mail is nog niet bevestigd. Check je inbox.';
      } else if (msg.includes('rate limit') || msg.includes('too many requests')) {
        dutch = 'Te veel pogingen. Wacht even en probeer het later opnieuw.';
      } else if (msg.includes('network')) {
        dutch = 'Geen internetverbinding. Check je netwerk.';
      }
      toast(dutch, false);
    }
  });
  document.getElementById('logoutBtn')?.addEventListener('click', () => db.auth.signOut());

  document.querySelectorAll('.adm-tab').forEach(t => {
    t.addEventListener('click', () => {
      if (t.disabled) return;
      switchTab(t.dataset.tab);
    });
  });

  document.getElementById('songFilter')?.addEventListener('input', () => {
    songPage = 0;
    renderSongGrid();
  });

  document.getElementById('newSongBtn')?.addEventListener('click', newSong);
  document.getElementById('saveSongBtn')?.addEventListener('click', saveSong);
  document.getElementById('deleteSongBtn')?.addEventListener('click', deleteSong);

  document.getElementById('addLineBtn')?.addEventListener('click', () => {
    if (!currentSong) { toast('Selecteer eerst een lied', false); return; }
    const t = ytPlayer?.getCurrentTime?.() ?? lastTimeSec;
    lines.push({ time: parseFloat(t.toFixed(2)), text: '' });
    sortLines();
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
  document.getElementById('saveLyricsBtn')?.addEventListener('click', e => {
    e.currentTarget.blur();
    saveLyrics();
  });
  document.getElementById('saveLyricsBtn2')?.addEventListener('click', e => {
    e.currentTarget.blur();
    saveLyrics();
  });
  document.getElementById('savePreviewBtn')?.addEventListener('click', e => {
    e.currentTarget.blur();
    saveLyrics();
  });
  document.getElementById('sortLinesBtn')?.addEventListener('click', () => {
    sortLines();
    renderTimingList();
    renderLyricsList();
    toast('Regels gesorteerd op tijd');
  });
  document.getElementById('searchForm')?.addEventListener('submit', e => {
    e.preventDefault();
    runAutoSearch();
  });
  document.getElementById('importLyricsBtn')?.addEventListener('click', importPastedLyrics);

  // Exporteer huidige regels naar het tekstvak rechts (alleen tekst, één per regel)
  document.getElementById('exportToTextBtn')?.addEventListener('click', () => {
    const ta = document.getElementById('lyricsResult');
    if (!ta) return;
    if (!currentSong) { toast('Selecteer eerst een lied', false); return; }
    if (lines.length === 0) { toast('Nog geen regels om te exporteren', false); return; }
    ta.value = lines.map(l => (l.text || '').trim()).join('\n');
    toast(`${lines.length} regel${lines.length === 1 ? '' : 's'} naar tekstvak gezet`);
  });

  // Kruisje rechtsboven het tekstvak — leeg de inhoud in één klik
  document.getElementById('clearLyricsResultBtn')?.addEventListener('click', () => {
    const ta = document.getElementById('lyricsResult');
    if (!ta) return;
    ta.value = '';
    ta.focus();
  });

  // Kruisje in het zoek-invoerveld — wis de zoekterm
  document.getElementById('clearSearchQueryBtn')?.addEventListener('click', () => {
    const q = document.getElementById('searchQuery');
    if (!q) return;
    q.value = '';
    q.focus();
  });

  // Download de tekstvak-inhoud als .txt
  document.getElementById('downloadTxtBtn')?.addEventListener('click', () => {
    const ta = document.getElementById('lyricsResult');
    if (!ta || !ta.value.trim()) { toast('Tekstvak is leeg', false); return; }
    const safeTitle = (currentSong?.title || 'songtekst')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'songtekst';
    const blob = new Blob([ta.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
    toast('Tekst gedownload');
  });

  initShiftControls();
  initPreviewResize();

  // Spatiebalk-workflow in Sync: pak huidige videotijd voor de geselecteerde
  // regel, schuif daarna automatisch naar volgende regel. (Niet in Preview.)
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (activeTab !== 'timing') return;
    if (!currentSong || lines.length === 0) return;
    const tag = (document.activeElement?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    e.preventDefault();
    if (syncCursor < 0 || syncCursor >= lines.length) {
      toast('Klaar! Alle regels hebben een tijd.', true);
      return;
    }
    const t = ytPlayer?.getCurrentTime?.() ?? lastTimeSec;
    lines[syncCursor].time = parseFloat(t.toFixed(2));
    const justSet = syncCursor;
    syncCursor = Math.min(syncCursor + 1, lines.length);
    const focusIndex = syncCursor < lines.length ? syncCursor : justSet;
    renderTimingList();
    scrollCursorIntoView(focusIndex);
  });

  // Drag-and-drop voor regels (gedelegeerd op de lijst-containers)
  ['lyricsList', 'timingRows'].forEach(id => {
    const list = document.getElementById(id);
    if (!list) return;
    list.addEventListener('dragstart', handleDragStart);
    list.addEventListener('dragend',   handleDragEnd);
    list.addEventListener('dragover',  handleDragOver);
    list.addEventListener('drop',      handleDrop);
  });

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

} // einde van: if (window.__MEEZING_BLOCKED__) else
