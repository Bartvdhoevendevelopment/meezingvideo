// ============================================================
// Meezingvideo — homepage logic
// Feature: inline timing-editor per lyric-regel
// ============================================================

if (!window.MEEZINGVIDEO_CONFIG) {
  console.error('[Meezingvideo] supabase-config.js niet geladen!');
  alert('Configuratie ontbreekt. Controleer of supabase-config.js naast index.html staat.');
}
if (!window.supabase || !window.supabase.createClient) {
  console.error('[Meezingvideo] Supabase JS library niet geladen.');
}
const { supabaseUrl, supabaseAnonKey } = window.MEEZINGVIDEO_CONFIG || {};
const sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
console.log('[Meezingvideo] client klaar voor', supabaseUrl);

(async () => {
  try {
    const { data, error } = await sb.from('meezingvideo_songs').select('id, title').limit(5);
    if (error) console.error('[Meezingvideo] kan database niet bereiken:', error);
    else console.log('[Meezingvideo] ' + data.length + ' song(s) in database:', data);
  } catch (e) { console.error('[Meezingvideo] onverwachte fout:', e); }
})();

const homeView        = document.getElementById('homeView');
const playerView      = document.getElementById('playerView');
const backBtn         = document.getElementById('backBtn');
const npBar           = document.getElementById('npBar');
const searchInput     = document.getElementById('searchInput');
const searchResults   = document.getElementById('searchResults');
const songTitleEl     = document.getElementById('songTitle');
const songArtistEl    = document.getElementById('songArtist');
const lyricsListEl    = document.getElementById('lyricsList');
const autoScrollBtn   = document.getElementById('autoScrollBtn');
const layoutStackBtn  = document.getElementById('layoutStackBtn');
const layoutSideBtn   = document.getElementById('layoutSideBtn');
const playerSectionEl = document.getElementById('playerSection');
const toastEl         = document.getElementById('toast');

let currentSong   = null;
let currentLyrics = [];
let ytPlayer      = null;
let pollTimer     = null;
let activeIdx     = -1;
let autoScroll    = true;
let userInteractedRecently  = false;
let userInteractTimeout     = null;

// ── Timing editor state ──────────────────────────────────────
let timingPopup     = null;   // huidig open popup-element
let timingPopupIdx  = null;   // index van de regel waarvoor popup open is
let isSavingTiming  = false;

// ── Auth state: is er een ingelogde beheerder? ───────────────
let isAdmin = false;
sb.auth.getSession().then(({ data: { session } }) => {
  isAdmin = !!session;
  // herrender als er al lyrics zijn
  if (currentLyrics.length) renderLyrics();
});
sb.auth.onAuthStateChange((_, session) => {
  isAdmin = !!session;
  if (currentLyrics.length) renderLyrics();
});

// ============================================================
// Toast
// ============================================================
function showToast(msg, type) {
  type = type || '';
  toastEl.textContent = msg;
  toastEl.className = 'toast show ' + type;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

// ============================================================
// View switching
// ============================================================
function showHome() {
  homeView.classList.add('active');
  playerView.classList.remove('active');
  backBtn.style.display = 'none';
  if (npBar) npBar.style.display = 'none';
  if (ytPlayer && ytPlayer.pauseVideo) {
    try { ytPlayer.pauseVideo(); } catch (_) {}
  }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  closeTimingPopup();
  searchInput.value = '';
  searchResults.classList.remove('open');
  searchResults.innerHTML = '';
  if (document.activeElement === searchInput) searchInput.blur();
}

function showPlayer() {
  homeView.classList.remove('active');
  playerView.classList.add('active');
  backBtn.style.display = '';
  if (npBar) npBar.style.display = '';
}

backBtn.addEventListener('click', showHome);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (timingPopup) { closeTimingPopup(); return; }
    if (playerView.classList.contains('active')) showHome();
  }
});

// ============================================================
// Search
// ============================================================
let searchDebounce = null;
searchInput.addEventListener('input', e => {
  const q = e.target.value.trim();
  clearTimeout(searchDebounce);
  if (!q) { showAllSongs(); return; }
  searchDebounce = setTimeout(() => runSearch(q), 180);
});
searchInput.addEventListener('focus', () => {
  const q = searchInput.value.trim();
  if (q) runSearch(q); else showAllSongs();
});

async function showAllSongs() {
  try {
    const { data, error } = await sb
      .from('meezingvideo_songs')
      .select('id, title, artist, youtube_id, view_count')
      .order('view_count', { ascending: false, nullsFirst: false })
      .order('title', { ascending: true })
      .limit(50);
    if (error) throw error;
    renderResults(data || []);
  } catch (err) {
    showToast('Database niet bereikbaar: ' + err.message, 'error');
  }
}

async function runSearch(q) {
  try {
    const { data, error } = await sb
      .from('meezingvideo_songs')
      .select('id, title, artist, youtube_id, view_count')
      .or('title.ilike.%' + q + '%,artist.ilike.%' + q + '%')
      .order('view_count', { ascending: false, nullsFirst: false })
      .order('title', { ascending: true })
      .limit(50);
    if (error) throw error;
    renderResults(data || []);
  } catch (err) {
    showToast('Zoeken lukte niet: ' + err.message, 'error');
  }
}

function renderResults(items) {
  searchResults.innerHTML = '';
  if (!items.length) {
    searchResults.innerHTML = '<div class="search-empty">Geen liederen gevonden. Voeg er een toe via Beheer.</div>';
    searchResults.classList.add('open');
    return;
  }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'search-result';
    row.setAttribute('role', 'option');
    const views = Number.isFinite(it.view_count) ? it.view_count : 0;
    const viewsLabel = views === 1 ? '1 keer' : views + ' keer';
    row.innerHTML =
      '<img src="https://i.ytimg.com/vi/' + it.youtube_id + '/mqdefault.jpg" alt="" loading="lazy" />' +
      '<div class="meta">' +
        '<div class="title">' + escapeHtml(it.title) + '</div>' +
        '<div class="artist">' + escapeHtml(it.artist || '') + '</div>' +
      '</div>' +
      '<span class="tag views-tag" title="' + views + ' keer afgespeeld">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">' +
          '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>' +
        '</svg> ' + viewsLabel +
      '</span>';
    row.addEventListener('click', () => selectSong(it));
    searchResults.appendChild(row);
  }
  searchResults.classList.add('open');
  fitSearchResultsToViewport();
}

// Dynamisch max-height zodat dropdown altijd binnen viewport blijft
function fitSearchResultsToViewport() {
  if (!searchResults) return;
  const rect = searchResults.getBoundingClientRect();
  const viewH = window.innerHeight || document.documentElement.clientHeight;
  const available = viewH - rect.top - 16; // 16px marge onderaan
  if (available > 120) {
    searchResults.style.maxHeight = Math.max(120, available) + 'px';
  }
}

// Herbereken bij venstergrootte-wijziging
window.addEventListener('resize', () => {
  if (searchResults?.classList.contains('open')) fitSearchResultsToViewport();
});

// ============================================================
// Select song
// ============================================================
async function selectSong(song) {
  currentSong = song;
  showPlayer();
  songTitleEl.textContent = song.title;
  songArtistEl.textContent = song.artist || '';
  lyricsListEl.innerHTML = '<div class="lyrics-empty"><div class="spinner"></div></div>';
  activeIdx = -1;
  closeTimingPopup();
  // Verhoog view-counter (fire-and-forget, faalt stil als kolom of functie ontbreekt)
  sb.rpc('increment_song_views', { song_id: song.id }).then(undefined, () => {});
  try {
    const { data, error } = await sb
      .from('meezingvideo_lyrics')
      .select('id, time, text')
      .eq('song_id', song.id)
      .order('time', { ascending: true });
    if (error) throw error;
    // Map naar de oude veldnamen die elders in app.js worden gebruikt
    currentLyrics = (data || []).map(r => ({
      id: r.id,
      text: r.text,
      start_seconds: r.time,
      end_seconds: null
    }));
    renderLyrics();
  } catch (err) {
    lyricsListEl.innerHTML = '<div class="lyrics-empty">Tekst laden mislukt.</div>';
  }
  loadOrCueVideo(song.youtube_id);
}

// ============================================================
// Lyrics renderen  — met optioneel timing-edit icoontje
// ============================================================
function renderLyrics() {
  lyricsListEl.innerHTML = '';
  if (!currentLyrics.length) {
    lyricsListEl.innerHTML = '<div class="lyrics-empty">Nog geen tekst voor dit lied.</div>';
    return;
  }

  currentLyrics.forEach((line, idx) => {
    const el = document.createElement('div');
    el.className = 'lyric-line';
    el.dataset.idx = idx;

    // tekst
    const textSpan = document.createElement('span');
    textSpan.className = 'lyric-text';
    textSpan.textContent = line.text;
    el.appendChild(textSpan);

    // klik op tekst → spring naar dat moment
    textSpan.addEventListener('click', () => seekTo(line.start_seconds));

    lyricsListEl.appendChild(el);
  });
}

function formatSeconds(sec) {
  const s = parseFloat(sec) || 0;
  const m = Math.floor(s / 60);
  const ss = (s - m * 60).toFixed(1).padStart(4, '0');
  return m > 0 ? `${m}:${ss}` : `${ss}s`;
}

// ============================================================
// Timing popup
// ============================================================
function openTimingPopup(idx, anchorEl) {
  // sluit bestaande popup
  if (timingPopup) closeTimingPopup();

  timingPopupIdx = idx;
  const line = currentLyrics[idx];

  const popup = document.createElement('div');
  popup.className = 'timing-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'Timing aanpassen');

  popup.innerHTML = `
    <div class="timing-popup-header">
      <span class="timing-popup-title">⏱ Timing aanpassen</span>
      <button class="timing-popup-close" title="Sluiten">✕</button>
    </div>
    <div class="timing-popup-lyric">${escapeHtml(line.text)}</div>
    <div class="timing-popup-time" id="timingDisplayVal">${formatSeconds(line.start_seconds)}</div>
    <div class="timing-popup-btns">
      <button class="tpb" data-d="-1">−1s</button>
      <button class="tpb" data-d="-0.5">−½s</button>
      <button class="tpb snap" id="timingSnapBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        Huidige tijd
      </button>
      <button class="tpb" data-d="0.5">+½s</button>
      <button class="tpb" data-d="1">+1s</button>
    </div>
    <div class="timing-popup-footer">
      <button class="tpb-save" id="timingSaveBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <path d="M17 21v-8H7v8M7 3v5h8"/>
        </svg>
        Opslaan
      </button>
      <span class="timing-popup-hint">ESC om te sluiten</span>
    </div>
  `;

  // bewaar de huidige (mogelijk nog niet opgeslagen) tijdwaarde lokaal in popup
  let localTime = parseFloat(line.start_seconds);

  function updateDisplay() {
    popup.querySelector('#timingDisplayVal').textContent = formatSeconds(localTime);
    popup.querySelector('.lyric-timing-btn span') &&
      (anchorEl.querySelector('span').textContent = formatSeconds(localTime));
  }

  // ± knoppen
  popup.querySelectorAll('.tpb[data-d]').forEach(btn => {
    btn.addEventListener('click', () => {
      localTime = Math.max(0, localTime + parseFloat(btn.dataset.d));
      updateDisplay();
    });
  });

  // snap naar huidige videotijd
  popup.querySelector('#timingSnapBtn').addEventListener('click', () => {
    if (ytPlayer?.getCurrentTime) {
      localTime = parseFloat(ytPlayer.getCurrentTime().toFixed(2));
      updateDisplay();
    } else {
      showToast('Video nog niet gestart', 'error');
    }
  });

  // sluit
  popup.querySelector('.timing-popup-close').addEventListener('click', closeTimingPopup);

  // opslaan
  popup.querySelector('#timingSaveBtn').addEventListener('click', async () => {
    if (isSavingTiming) return;
    await saveTiming(idx, localTime);
    closeTimingPopup();
  });

  // klik buiten popup → sluit
  setTimeout(() => {
    document.addEventListener('click', outsideClick);
  }, 50);

  document.body.appendChild(popup);
  timingPopup = popup;

  // positioneer popup bij de knop
  positionPopup(popup, anchorEl);
}

function positionPopup(popup, anchor) {
  const r = anchor.getBoundingClientRect();
  const pw = 280;
  let left = r.left + window.scrollX;
  let top  = r.bottom + window.scrollY + 6;

  // zorg dat popup niet buiten scherm valt
  if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
  if (left < 10) left = 10;

  // als popup onder scherm uitkomt, toon dan erboven
  const ph = 200; // geschatte hoogte
  if (top + ph > window.innerHeight + window.scrollY) {
    top = r.top + window.scrollY - ph - 6;
  }

  popup.style.left = left + 'px';
  popup.style.top  = top + 'px';
}

function outsideClick(e) {
  if (timingPopup && !timingPopup.contains(e.target) &&
      !e.target.closest('.lyric-timing-btn')) {
    closeTimingPopup();
  }
}

function closeTimingPopup() {
  if (timingPopup) {
    timingPopup.remove();
    timingPopup = null;
    timingPopupIdx = null;
    document.removeEventListener('click', outsideClick);
  }
}

// ============================================================
// Timing opslaan in Supabase
// ============================================================
async function saveTiming(idx, newTime) {
  const line = currentLyrics[idx];
  if (!line?.id) { showToast('Geen ID gevonden voor deze regel', 'error'); return; }

  isSavingTiming = true;
  const saveBtn = timingPopup?.querySelector('#timingSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Opslaan…'; }

  try {
    const { error } = await sb
      .from('meezingvideo_lyrics')
      .update({ time: newTime })
      .eq('id', line.id);

    if (error) throw error;

    // update lokale state
    currentLyrics[idx].start_seconds = newTime;

    // update het icoontje in de lijst
    const lineEl = lyricsListEl.querySelector('.lyric-line[data-idx="' + idx + '"]');
    if (lineEl) {
      const btn = lineEl.querySelector('.lyric-timing-btn span');
      if (btn) btn.textContent = formatSeconds(newTime);
    }

    showToast('Timing opgeslagen ✓');
  } catch (err) {
    showToast('Opslaan mislukt: ' + err.message, 'error');
  } finally {
    isSavingTiming = false;
  }
}

// ============================================================
// YouTube IFrame API
// ============================================================
let ytApiReady = false;
let ytApiReadyResolvers = [];
window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  ytApiReadyResolvers.forEach(r => r());
  ytApiReadyResolvers = [];
};
function waitForYTApi() {
  return new Promise(resolve => {
    if (ytApiReady) return resolve();
    ytApiReadyResolvers.push(resolve);
  });
}
(function loadYTApi() {
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
})();

// Status-balk reageert op YT player state
const NP_STATES = {
  '-1': { text: 'klaar om af te spelen', cls: 'paused' },   // UNSTARTED
  '0':  { text: 'afgelopen',             cls: 'ended'  },   // ENDED
  '1':  { text: 'wordt afgespeeld',      cls: ''       },   // PLAYING
  '2':  { text: 'gepauzeerd',            cls: 'paused' },   // PAUSED
  '3':  { text: 'aan het laden…',        cls: 'buffering' },// BUFFERING
  '5':  { text: 'klaar om af te spelen', cls: 'paused' }    // CUED
};
function updateNpStatus(stateCode) {
  const wrap = document.getElementById('npStatus');
  const txt  = document.getElementById('npStatusText');
  if (!wrap || !txt) return;
  const info = NP_STATES[String(stateCode)] || { text: 'wordt afgespeeld', cls: '' };
  txt.textContent = info.text;
  wrap.classList.remove('paused', 'ended', 'buffering');
  if (info.cls) wrap.classList.add(info.cls);
}

async function loadOrCueVideo(videoId) {
  if (!videoId) {
    console.warn('[meezingvideo] Geen YouTube-ID voor dit lied');
    showVideoError('Dit lied heeft geen YouTube-link.');
    return;
  }
  // Sla videoId direct op zodat fallback ook werkt
  pendingVideoId = videoId;

  // Wacht max 4 seconden op de YT IFrame API; daarna fallback naar directe iframe
  const apiReady = await Promise.race([
    waitForYTApi().then(() => true),
    new Promise(r => setTimeout(() => r(false), 4000))
  ]);

  if (!apiReady) {
    console.warn('[meezingvideo] YT IFrame API laadt niet, fallback naar directe iframe');
    injectDirectIframe(videoId);
    return;
  }

  try {
    if (!ytPlayer) {
      ytPlayer = new YT.Player('ytPlayer', {
        videoId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => { startPolling(); updateNpStatus(5); },
          onStateChange: e => {
            updateNpStatus(e.data);
            if (e.data === YT.PlayerState.PLAYING) startPolling();
          },
          onError: e => console.error('[meezingvideo] YT player error code', e?.data)
        }
      });
    } else if (typeof ytPlayer.loadVideoById === 'function') {
      ytPlayer.loadVideoById(videoId);
      startPolling();
    } else {
      // ytPlayer-variabele bestaat maar is geen werkende speler — fallback
      injectDirectIframe(videoId);
    }
  } catch (err) {
    console.error('[meezingvideo] Fout bij aanmaken YT-player, fallback gebruikt:', err);
    injectDirectIframe(videoId);
  }
}

let pendingVideoId = null;
function injectDirectIframe(videoId) {
  const stage = document.querySelector('.video-frame');
  if (!stage) return;
  stage.innerHTML = `<iframe
    src="https://www.youtube.com/embed/${encodeURIComponent(videoId)}?rel=0&modestbranding=1&playsinline=1"
    allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen></iframe>`;
  // Polling/sync werkt niet meer met directe iframe, maar de video draait wel
  ytPlayer = null;
}
function showVideoError(msg) {
  const stage = document.querySelector('.video-frame');
  if (!stage) return;
  stage.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#fff;text-align:center;padding:20px;">${msg}</div>`;
}

function seekTo(seconds) {
  if (!ytPlayer?.seekTo) return;
  ytPlayer.seekTo(Number(seconds), true);
  ytPlayer.playVideo();
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(syncLyrics, 200);
}

function syncLyrics() {
  if (!ytPlayer?.getCurrentTime || !currentLyrics.length) return;
  let t;
  try { t = ytPlayer.getCurrentTime(); } catch (e) { return; }
  if (typeof t !== 'number') return;
  let idx = -1;
  for (let i = 0; i < currentLyrics.length; i++) {
    if (Number(currentLyrics[i].start_seconds) <= t) idx = i; else break;
  }
  if (idx !== activeIdx) setActiveLine(idx);
}

function setActiveLine(idx) {
  const prevActive = lyricsListEl.querySelector('.lyric-line.active');
  if (prevActive) prevActive.classList.remove('active');
  Array.from(lyricsListEl.children).forEach((el, i) => {
    if (i < idx) el.classList.add('passed'); else el.classList.remove('passed');
  });
  activeIdx = idx;
  if (idx < 0) return;
  const lineEl = lyricsListEl.querySelector('.lyric-line[data-idx="' + idx + '"]');
  if (!lineEl) return;
  lineEl.classList.add('active');
  if (autoScroll && !userInteractedRecently) {
    const container = lyricsListEl;
    const lineRect = lineEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const offset = lineRect.top - containerRect.top - container.clientHeight / 2 + lineEl.clientHeight / 2;
    container.scrollBy({ top: offset, behavior: 'smooth' });
  }
}

lyricsListEl.addEventListener('wheel',      markInteract, { passive: true });
lyricsListEl.addEventListener('touchstart', markInteract, { passive: true });
function markInteract() {
  userInteractedRecently = true;
  clearTimeout(userInteractTimeout);
  userInteractTimeout = setTimeout(() => { userInteractedRecently = false; }, 3500);
}

autoScrollBtn.addEventListener('click', () => {
  autoScroll = !autoScroll;
  autoScrollBtn.classList.toggle('on', autoScroll);
});

// ============================================================
// Layout toggle
// ============================================================
function applyLayout(mode) {
  if (!playerSectionEl) return;
  if (mode === 'side') {
    playerSectionEl.classList.add('layout-side');
    layoutSideBtn?.setAttribute('aria-pressed', 'true');
    layoutStackBtn?.setAttribute('aria-pressed', 'false');
  } else {
    playerSectionEl.classList.remove('layout-side');
    layoutStackBtn?.setAttribute('aria-pressed', 'true');
    layoutSideBtn?.setAttribute('aria-pressed', 'false');
  }
  try { localStorage.setItem('mzv_layout', mode); } catch (_) {}
}

layoutStackBtn?.addEventListener('click', () => applyLayout('stack'));
layoutSideBtn?.addEventListener('click',  () => applyLayout('side'));

function isMobile() { return window.matchMedia('(max-width: 720px)').matches; }
try {
  const saved = localStorage.getItem('mzv_layout');
  if (isMobile()) { applyLayout('stack'); }
  else if (saved === 'side' || saved === 'stack') { applyLayout(saved); }
} catch (_) {}

window.addEventListener('resize', () => {
  if (isMobile() && playerSectionEl?.classList.contains('layout-side')) {
    playerSectionEl.classList.remove('layout-side');
  }
});

// ============================================================
// Deep link
// ============================================================
(async function deepLink() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (!id) return;
  const { data, error } = await sb
    .from('meezingvideo_songs')
    .select('id, title, artist, youtube_id')
    .eq('id', id)
    .single();
  if (!error && data) selectSong(data);
})();
