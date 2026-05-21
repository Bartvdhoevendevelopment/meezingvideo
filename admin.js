/* ============================================================
   admin.js  —  Meezingvideo beheermodule
   Feature: timing-editor met drag-reorder, shift-all en
            fine-tune per regel naast de YouTube-speler
   ============================================================ */

// ── Supabase client (aangemaakt in supabase-config.js) ──────
const { createClient } = supabase;
const { supabaseUrl, supabaseAnonKey } = window.MEEZINGVIDEO_CONFIG;
const db = createClient(supabaseUrl, supabaseAnonKey);

// ── State ───────────────────────────────────────────────────
let currentSong = null;   // { id, title, artist, youtube_id, description }
let lines       = [];     // [{ id?, time, text }, ...]  (gesorteerd op time)
let ytPlayer    = null;
let ytReady     = false;
let timeInterval = null;
let dragSrc     = null;   // drag-and-drop bron-index

// ── YouTube IFrame API ───────────────────────────────────────
window.onYouTubeIframeAPIReady = function () { ytReady = true; };

function initYT(videoId) {
  if (ytPlayer) { ytPlayer.loadVideoById(videoId); return; }
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
            document.getElementById('currentTimeLabel').textContent =
              ytPlayer.getCurrentTime().toFixed(2) + 's';
          }
        }, 100);
      }
    }
  });
}

// ── Hulpfuncties ────────────────────────────────────────────
function extractVideoId(raw) {
  raw = raw.trim();
  const m = raw.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (raw.length === 11 ? raw : null);
}

function toast(msg, ok = true) {
  const el = document.getElementById('toast');
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

// ── Songtekst editor renderen ────────────────────────────────
function renderLyrics() {
  const container = document.getElementById('lyricsEditor');
  document.getElementById('lineCount').textContent = lines.length;
  container.innerHTML = '';

  if (lines.length === 0) {
    container.innerHTML = '<p class="helper" style="text-align:center;padding:24px 0;">Nog geen regels. Voeg er één toe of gebruik bulk-import.</p>';
    return;
  }

  lines.forEach((line, i) => {
    const row = document.createElement('div');
    row.className = 'lyrics-row';
    row.draggable = true;
    row.dataset.index = i;

    // ── Drag events ──────────────────────────────────────────
    row.addEventListener('dragstart', e => {
      dragSrc = i;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (dragSrc === null || dragSrc === i) return;
      const moved = lines.splice(dragSrc, 1)[0];
      lines.splice(i, 0, moved);
      renderLyrics();
    });

    row.innerHTML = `
      <div class="row-handle" title="Sleep om te hersorteren">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/>
          <circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/>
          <circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>
        </svg>
      </div>

      <div class="row-time-block">
        <label class="row-time-label">Tijd (s)</label>
        <div class="row-time-controls">
          <button class="time-btn" data-i="${i}" data-d="-1"   title="-1s">−1</button>
          <button class="time-btn" data-i="${i}" data-d="-0.5" title="-0.5s">−½</button>
          <input  class="time-input" type="number" step="0.1" min="0"
                  value="${parseFloat(line.time).toFixed(2)}" data-i="${i}" />
          <button class="time-btn" data-i="${i}" data-d="0.5"  title="+0.5s">+½</button>
          <button class="time-btn" data-i="${i}" data-d="1"    title="+1s">+1</button>
          <button class="snap-btn" data-i="${i}" title="Pak huidige videotijd">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
          </button>
        </div>
        <span class="row-time-fmt">${fmtTime(line.time)}</span>
      </div>

      <input class="row-text" type="text" value="${escHtml(line.text)}"
             placeholder="Tekstregel…" data-i="${i}" />

      <button class="row-preview-btn" data-i="${i}" title="Spring naar dit moment in video">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </button>
      <button class="row-delete-btn" data-i="${i}" title="Verwijder regel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    `;

    container.appendChild(row);
  });

  // ── Event delegation voor knoppen in de editor ───────────
  container.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i, d = parseFloat(btn.dataset.d);
      lines[i].time = Math.max(0, parseFloat(lines[i].time) + d);
      renderLyrics();
    });
  });

  container.querySelectorAll('.time-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = +inp.dataset.i;
      lines[i].time = Math.max(0, parseFloat(inp.value) || 0);
      // update fmt label live
      const fmt = inp.closest('.row-time-block').querySelector('.row-time-fmt');
      if (fmt) fmt.textContent = fmtTime(lines[i].time);
    });
  });

  container.querySelectorAll('.snap-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      const t = ytPlayer?.getCurrentTime?.() ?? 0;
      lines[i].time = parseFloat(t.toFixed(2));
      renderLyrics();
    });
  });

  container.querySelectorAll('.row-preview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      if (ytPlayer?.seekTo) ytPlayer.seekTo(lines[i].time, true);
    });
  });

  container.querySelectorAll('.row-text').forEach(inp => {
    inp.addEventListener('input', () => {
      lines[+inp.dataset.i].text = inp.value;
    });
  });

  container.querySelectorAll('.row-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      lines.splice(+btn.dataset.i, 1);
      renderLyrics();
    });
  });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Shift-all timing ─────────────────────────────────────────
function initShiftControls() {
  const shiftVal = () => parseFloat(document.getElementById('shiftSeconds')?.value) || 0;

  document.getElementById('shiftEarlierBtn')?.addEventListener('click', () => {
    const d = shiftVal();
    lines.forEach(l => { l.time = Math.max(0, parseFloat(l.time) - d); });
    renderLyrics();
    toast(`Alle regels ${d}s eerder gezet`);
  });

  document.getElementById('shiftLaterBtn')?.addEventListener('click', () => {
    const d = shiftVal();
    lines.forEach(l => { l.time = parseFloat(l.time) + d; });
    renderLyrics();
    toast(`Alle regels ${d}s later gezet`);
  });
}

// ── Songenlijst laden ────────────────────────────────────────
async function loadSongs() {
  const { data, error } = await db.from('meezingvideo_songs')
    .select('id,title,artist').order('title');
  if (error) { toast('Fout bij laden liederen: ' + error.message, false); return; }

  const filter = document.getElementById('songFilter').value.toLowerCase();
  const list   = document.getElementById('songList');
  list.innerHTML = '';

  (data || [])
    .filter(s => s.title.toLowerCase().includes(filter) || (s.artist||'').toLowerCase().includes(filter))
    .forEach(song => {
      const btn = document.createElement('button');
      btn.className = 'song-item' + (currentSong?.id === song.id ? ' active' : '');
      btn.innerHTML = `<strong>${escHtml(song.title)}</strong><span>${escHtml(song.artist||'')}</span>`;
      btn.addEventListener('click', () => selectSong(song.id));
      list.appendChild(btn);
    });
}

// ── Lied selecteren ──────────────────────────────────────────
async function selectSong(id) {
  const { data: song, error: e1 } = await db.from('meezingvideo_songs')
    .select('*').eq('id', id).single();
  if (e1) { toast('Fout: ' + e1.message, false); return; }

  const { data: lyricsData, error: e2 } = await db.from('meezingvideo_lyrics')
    .select('*').eq('song_id', id).order('time');

  currentSong = song;
  lines = (lyricsData || []).map(r => ({ id: r.id, time: r.time, text: r.text }));

  document.getElementById('fieldTitle').value       = song.title || '';
  document.getElementById('fieldArtist').value      = song.artist || '';
  document.getElementById('fieldYoutube').value     = song.youtube_id || '';
  document.getElementById('fieldDescription').value = song.description || '';
  document.getElementById('editorTitle').textContent = 'Lied bewerken';
  document.getElementById('editorEmpty').style.display  = 'none';
  document.getElementById('editor').style.display       = '';
  document.getElementById('deleteSongBtn').style.display = '';

  if (song.youtube_id) {
    document.getElementById('previewCard').style.display = '';
    initYT(song.youtube_id);
  }

  renderLyrics();
  loadSongs(); // update active state
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
  document.getElementById('editorEmpty').style.display  = 'none';
  document.getElementById('editor').style.display       = '';
  document.getElementById('previewCard').style.display  = 'none';
  document.getElementById('deleteSongBtn').style.display = 'none';
  renderLyrics();
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

  if (youtube_id && (!currentSong || currentSong.youtube_id !== youtube_id)) {
    document.getElementById('previewCard').style.display = '';
    initYT(youtube_id);
  }

  currentSong = { ...payload, id: songId };
  toast('Lied opgeslagen ✓');
  loadSongs();
}

// ── Lied verwijderen ─────────────────────────────────────────
async function deleteSong() {
  if (!currentSong?.id) return;
  if (!confirm(`Weet je zeker dat je "${currentSong.title}" wilt verwijderen?`)) return;
  await db.from('meezingvideo_lyrics').delete().eq('song_id', currentSong.id);
  await db.from('meezingvideo_songs').delete().eq('id', currentSong.id);
  currentSong = null;
  lines = [];
  document.getElementById('editor').style.display      = 'none';
  document.getElementById('editorEmpty').style.display = '';
  toast('Lied verwijderd');
  loadSongs();
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

// ── Bulk import ──────────────────────────────────────────────
function bulkParse() {
  const raw = document.getElementById('bulkText').value;
  const parsed = [];
  raw.split('\n').forEach(line => {
    line = line.trim();
    if (!line) return;
    // formaten: "0.0 tekst"  "00:02.5 tekst"  "1:02 tekst"
    const m = line.match(/^(\d+:)?(\d+(?:[.,]\d+)?)\s+(.+)$/);
    if (m) {
      const mins = m[1] ? parseInt(m[1]) : 0;
      const secs = parseFloat(m[2].replace(',', '.'));
      parsed.push({ time: mins * 60 + secs, text: m[3].trim() });
    }
  });
  if (parsed.length === 0) { toast('Geen geldige regels gevonden', false); return; }
  lines.push(...parsed);
  sortLines();
  document.getElementById('bulkText').value = '';
  renderLyrics();
  toast(`${parsed.length} regel(s) geïmporteerd`);
}

// ── Init (auth) ──────────────────────────────────────────────
async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (session) showAdmin();
  else         showLogin();

  db.auth.onAuthStateChange((_, session) => {
    if (session) showAdmin(); else showLogin();
  });
}

function showLogin() {
  document.getElementById('loginView').style.display  = '';
  document.getElementById('adminView').style.display  = 'none';
  document.getElementById('logoutBtn').style.display  = 'none';
}

function showAdmin() {
  document.getElementById('loginView').style.display  = 'none';
  document.getElementById('adminView').style.display  = '';
  document.getElementById('logoutBtn').style.display  = '';
  loadSongs();
}

// ── DOM-ready ────────────────────────────────────────────────
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

  // Songlijst filter
  document.getElementById('songFilter')?.addEventListener('input', loadSongs);

  // Song acties
  document.getElementById('newSongBtn')?.addEventListener('click', newSong);
  document.getElementById('saveSongBtn')?.addEventListener('click', saveSong);
  document.getElementById('deleteSongBtn')?.addEventListener('click', deleteSong);
  document.getElementById('saveLyricsBtn')?.addEventListener('click', saveLyrics);

  // Sorteren & regel toevoegen
  document.getElementById('sortLinesBtn')?.addEventListener('click', () => { sortLines(); renderLyrics(); });
  document.getElementById('addLineBtn')?.addEventListener('click', () => {
    const t = ytPlayer?.getCurrentTime?.() ?? 0;
    lines.push({ time: parseFloat(t.toFixed(2)), text: '' });
    renderLyrics();
    // scroll naar laatste regel
    const rows = document.querySelectorAll('.lyrics-row');
    rows[rows.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // Pak tijd (bestaande knop boven video)
  document.getElementById('captureTimeBtn')?.addEventListener('click', () => {
    const t = ytPlayer?.getCurrentTime?.() ?? 0;
    lines.push({ time: parseFloat(t.toFixed(2)), text: '' });
    renderLyrics();
  });

  // Bulk import
  document.getElementById('bulkParseBtn')?.addEventListener('click', bulkParse);

  // Shift-all controls
  initShiftControls();
});
