// ============================================================
// Meezingvideo — homepage logic (fullscreen views)
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

const homeView      = document.getElementById('homeView');
const playerView    = document.getElementById('playerView');
const backBtn       = document.getElementById('backBtn');
const npBar         = document.getElementById('npBar');
const searchInput   = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const songTitleEl   = document.getElementById('songTitle');
const songArtistEl  = document.getElementById('songArtist');
const lyricsListEl  = document.getElementById('lyricsList');
const autoScrollBtn = document.getElementById('autoScrollBtn');
const layoutStackBtn = document.getElementById('layoutStackBtn');
const layoutSideBtn  = document.getElementById('layoutSideBtn');
const playerSectionEl = document.getElementById('playerSection');
const toast         = document.getElementById('toast');

let currentSong = null;
let currentLyrics = [];
let ytPlayer = null;
let pollTimer = null;
let activeIdx = -1;
let autoScroll = true;
let userInteractedRecently = false;
let userInteractTimeout = null;

function showToast(msg, type) {
  type = type || '';
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 2400);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
}

// ============================================================
// View switching
// ============================================================
function showHome() {
  homeView.classList.add('active');
  playerView.classList.remove('active');
  backBtn.style.display = 'none';
  if (npBar) npBar.style.display = 'none';
  // pauzeer video als die speelt
  if (ytPlayer && ytPlayer.pauseVideo) {
    try { ytPlayer.pauseVideo(); } catch (_) {}
  }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  // Zoekvak leegmaken en dropdown sluiten — verschijnt pas weer als gebruiker erin klikt
  searchInput.value = '';
  searchResults.classList.remove('open');
  searchResults.innerHTML = '';
  // expliciet GEEN focus — gebruiker moet zelf klikken
  if (document.activeElement === searchInput) searchInput.blur();
}

function showPlayer() {
  homeView.classList.remove('active');
  playerView.classList.add('active');
  backBtn.style.display = '';
  if (npBar) npBar.style.display = '';
}

backBtn.addEventListener('click', showHome);

// ESC = terug
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && playerView.classList.contains('active')) showHome();
});

// ============================================================
// Search
// ============================================================
let searchDebounce = null;
searchInput.addEventListener('input', function (e) {
  const q = e.target.value.trim();
  clearTimeout(searchDebounce);
  if (!q) { showAllSongs(); return; }
  searchDebounce = setTimeout(function () { runSearch(q); }, 180);
});

searchInput.addEventListener('focus', function () {
  const q = searchInput.value.trim();
  if (q) runSearch(q); else showAllSongs();
});

async function showAllSongs() {
  try {
    const { data, error } = await sb
      .from('meezingvideo_songs')
      .select('id, title, artist, youtube_id')
      .order('title', { ascending: true })
      .limit(20);
    if (error) throw error;
    renderResults(data || []);
  } catch (err) {
    console.error(err);
    showToast('Database niet bereikbaar: ' + err.message, 'error');
  }
}

async function runSearch(q) {
  try {
    const { data, error } = await sb
      .from('meezingvideo_songs')
      .select('id, title, artist, youtube_id')
      .or('title.ilike.%' + q + '%,artist.ilike.%' + q + '%')
      .order('title', { ascending: true })
      .limit(20);
    if (error) throw error;
    renderResults(data || []);
  } catch (err) {
    console.error(err);
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
    row.innerHTML =
      '<img src="https://i.ytimg.com/vi/' + it.youtube_id + '/mqdefault.jpg" alt="" loading="lazy" />' +
      '<div class="meta">' +
        '<div class="title">' + escapeHtml(it.title) + '</div>' +
        '<div class="artist">' + escapeHtml(it.artist || '') + '</div>' +
      '</div>' +
      '<span class="tag">Meezingen</span>';
    row.addEventListener('click', function () { selectSong(it); });
    searchResults.appendChild(row);
  }
  searchResults.classList.add('open');
}

// ============================================================
// Select song → load lyrics, show player view
// ============================================================
async function selectSong(song) {
  currentSong = song;
  showPlayer();
  songTitleEl.textContent = song.title;
  songArtistEl.textContent = song.artist || '';
  lyricsListEl.innerHTML = '<div class="lyrics-empty"><div class="spinner"></div></div>';
  activeIdx = -1;
  try {
    const { data, error } = await sb
      .from('meezingvideo_lyrics')
      .select('id, start_seconds, end_seconds, text, line_order')
      .eq('song_id', song.id)
      .order('start_seconds', { ascending: true });
    if (error) throw error;
    currentLyrics = data || [];
    renderLyrics();
  } catch (err) {
    console.error(err);
    lyricsListEl.innerHTML = '<div class="lyrics-empty">Tekst laden mislukt.</div>';
  }
  loadOrCueVideo(song.youtube_id);
}

function renderLyrics() {
  lyricsListEl.innerHTML = '';
  if (!currentLyrics.length) {
    lyricsListEl.innerHTML = '<div class="lyrics-empty">Nog geen tekst voor dit lied.</div>';
    return;
  }
  currentLyrics.forEach(function (line, idx) {
    const el = document.createElement('div');
    el.className = 'lyric-line';
    el.textContent = line.text;
    el.dataset.idx = idx;
    el.addEventListener('click', function () { seekTo(line.start_seconds); });
    lyricsListEl.appendChild(el);
  });
}

// ============================================================
// YouTube IFrame API
// ============================================================
let ytApiReady = false;
let ytApiReadyResolvers = [];
window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  ytApiReadyResolvers.forEach(function (r) { r(); });
  ytApiReadyResolvers = [];
};
function waitForYTApi() {
  return new Promise(function (resolve) {
    if (ytApiReady) return resolve();
    ytApiReadyResolvers.push(resolve);
  });
}
(function loadYTApi() {
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
})();

async function loadOrCueVideo(videoId) {
  await waitForYTApi();
  if (!ytPlayer) {
    ytPlayer = new YT.Player('ytPlayer', {
      videoId: videoId,
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onReady: function () { startPolling(); },
        onStateChange: function (e) {
          if (e.data === YT.PlayerState.PLAYING) startPolling();
        }
      }
    });
  } else {
    ytPlayer.loadVideoById(videoId);
    startPolling();
  }
}

function seekTo(seconds) {
  if (!ytPlayer || !ytPlayer.seekTo) return;
  ytPlayer.seekTo(Number(seconds), true);
  ytPlayer.playVideo();
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(syncLyrics, 200);
}

function syncLyrics() {
  if (!ytPlayer || !ytPlayer.getCurrentTime || !currentLyrics.length) return;
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
  Array.from(lyricsListEl.children).forEach(function (el, i) {
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

lyricsListEl.addEventListener('wheel', markInteract, { passive: true });
lyricsListEl.addEventListener('touchstart', markInteract, { passive: true });
function markInteract() {
  userInteractedRecently = true;
  clearTimeout(userInteractTimeout);
  userInteractTimeout = setTimeout(function () { userInteractedRecently = false; }, 3500);
}

autoScrollBtn.addEventListener('click', function () {
  autoScroll = !autoScroll;
  autoScrollBtn.classList.toggle('on', autoScroll);
});

// ============================================================
// Layout toggle (onder / naast video) — persistent via localStorage
// ============================================================
function applyLayout(mode) {
  if (!playerSectionEl) return;
  if (mode === 'side') {
    playerSectionEl.classList.add('layout-side');
    layoutSideBtn && layoutSideBtn.setAttribute('aria-pressed', 'true');
    layoutStackBtn && layoutStackBtn.setAttribute('aria-pressed', 'false');
  } else {
    playerSectionEl.classList.remove('layout-side');
    layoutStackBtn && layoutStackBtn.setAttribute('aria-pressed', 'true');
    layoutSideBtn && layoutSideBtn.setAttribute('aria-pressed', 'false');
  }
  try { localStorage.setItem('mzv_layout', mode); } catch (_) {}
}

if (layoutStackBtn) layoutStackBtn.addEventListener('click', function () { applyLayout('stack'); });
if (layoutSideBtn)  layoutSideBtn.addEventListener('click',  function () { applyLayout('side'); });

// Init: lees voorkeur uit localStorage — op mobiel altijd stack forceren
function isMobile() { return window.matchMedia('(max-width: 720px)').matches; }
try {
  const saved = localStorage.getItem('mzv_layout');
  if (isMobile()) {
    // Op mobiel altijd onder elkaar (geen toggle zichtbaar)
    applyLayout('stack');
  } else if (saved === 'side' || saved === 'stack') {
    applyLayout(saved);
  }
} catch (_) {}

// Wanneer scherm krimpt naar mobiel: forceer stack
window.addEventListener('resize', function () {
  if (isMobile() && playerSectionEl && playerSectionEl.classList.contains('layout-side')) {
    playerSectionEl.classList.remove('layout-side');
  }
});

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
