// ============================================================
// Meezingvideo — admin logic
// ============================================================

const { supabaseUrl, supabaseAnonKey } = window.MEEZINGVIDEO_CONFIG;
const sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

const loginView = document.getElementById('loginView');
const adminView = document.getElementById('adminView');
const loginForm = document.getElementById('loginForm');
const loginSubmit = document.getElementById('loginSubmit');
const logoutBtn = document.getElementById('logoutBtn');
const songList = document.getElementById('songList');
const songFilter = document.getElementById('songFilter');
const newSongBtn = document.getElementById('newSongBtn');
const editor = document.getElementById('editor');
const editorEmpty = document.getElementById('editorEmpty');
const editorTitle = document.getElementById('editorTitle');
const fieldTitle = document.getElementById('fieldTitle');
const fieldArtist = document.getElementById('fieldArtist');
const fieldYoutube = document.getElementById('fieldYoutube');
const fieldDescription = document.getElementById('fieldDescription');
const saveSongBtn = document.getElementById('saveSongBtn');
const deleteSongBtn = document.getElementById('deleteSongBtn');
const previewCard = document.getElementById('previewCard');
const captureTimeBtn = document.getElementById('captureTimeBtn');
const currentTimeLabel = document.getElementById('currentTimeLabel');
const lyricsEditor = document.getElementById('lyricsEditor');
const lineCount = document.getElementById('lineCount');
const addLineBtn = document.getElementById('addLineBtn');
const sortLinesBtn = document.getElementById('sortLinesBtn');
const saveLyricsBtn = document.getElementById('saveLyricsBtn');
const bulkText = document.getElementById('bulkText');
const bulkParseBtn = document.getElementById('bulkParseBtn');
const toast = document.getElementById('toast');

let songs = [];
let currentSong = null;
let currentLines = [];
let adminYtPlayer = null;
let adminPollTimer = null;
let ytApiReady = false;
let ytApiReadyResolvers = [];

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

function extractYoutubeId(input) {
  if (!input) return '';
  input = input.trim();
  if (/^[a-zA-Z0-9_-]{6,15}$/.test(input) && !input.includes('/')) return input;
  try {
    const url = new URL(input);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1);
    const v = url.searchParams.get('v');
    if (v) return v;
    const m = url.pathname.match(/\/embed\/([\w-]+)/);
    if (m) return m[1];
    const m2 = url.pathname.match(/\/shorts\/([\w-]+)/);
    if (m2) return m2[1];
  } catch (_) { }
  return input;
}

function fmtTime(sec) {
  sec = Number(sec) || 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  if (m === 0) return s.toFixed(2) + 's';
  return m + ':' + s.toFixed(2).padStart(5, '0');
}

function parseTimeString(s) {
  s = String(s).trim();
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) showAdmin(); else showLogin();
}

function showLogin() {
  loginView.style.display = '';
  adminView.style.display = 'none';
  logoutBtn.style.display = 'none';
}

function showAdmin() {
  loginView.style.display = 'none';
  adminView.style.display = '';
  logoutBtn.style.display = '';
  loadSongs();
}

loginForm.addEventListener('submit', async function (e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  loginSubmit.disabled = true;
  loginSubmit.innerHTML = '<span class="spinner"></span> Inloggen...';
  try {
    const { error } = await sb.auth.signInWithPassword({ email: email, password: password });
    if (error) throw error;
    showToast('Welkom terug!', 'success');
    showAdmin();
  } catch (err) {
    showToast('Inloggen mislukt: ' + err.message, 'error');
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Inloggen';
  }
});

logoutBtn.addEventListener('click', async function () {
  await sb.auth.signOut();
  currentSong = null;
  songs = [];
  showLogin();
  showToast('Uitgelogd.');
});

async function loadSongs() {
  const { data, error } = await sb
    .from('meezingvideo_songs')
    .select('id, title, artist, youtube_id, description, created_at')
    .order('title', { ascending: true });
  if (error) { showToast('Liederen laden mislukt: ' + error.message, 'error'); return; }
  songs = data || [];
  renderSongList();
}

function renderSongList() {
  const q = songFilter.value.trim().toLowerCase();
  const filtered = q ? songs.filter(function (s) {
    return s.title.toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q);
  }) : songs;
  songList.innerHTML = '';
  if (!filtered.length) {
    songList.innerHTML = '<div class="helper" style="padding:8px 4px;">Geen liederen.</div>';
    return;
  }
  for (const s of filtered) {
    const row = document.createElement('div');
    row.className = 'song-row' + (currentSong && currentSong.id === s.id ? ' selected' : '');
    row.innerHTML =
      '<img src="https://i.ytimg.com/vi/' + s.youtube_id + '/mqdefault.jpg" alt="" loading="lazy" />' +
      '<div class="info">' +
        '<div class="t">' + escapeHtml(s.title) + '</div>' +
        '<div class="a">' + escapeHtml(s.artist || '-') + '</div>' +
      '</div>';
    row.addEventListener('click', function () { selectSong(s); });
    songList.appendChild(row);
  }
}
songFilter.addEventListener('input', renderSongList);

newSongBtn.addEventListener('click', function () {
  currentSong = { isNew: true };
  currentLines = [];
  editorEmpty.style.display = 'none';
  editor.style.display = '';
  editorTitle.textContent = 'Nieuw lied';
  fieldTitle.value = '';
  fieldArtist.value = '';
  fieldYoutube.value = '';
  fieldDescription.value = '';
  previewCard.style.display = 'none';
  renderLyricsEditor();
  renderSongList();
});

async function selectSong(song) {
  currentSong = song;
  editorEmpty.style.display = 'none';
  editor.style.display = '';
  editorTitle.textContent = 'Lied bewerken';
  fieldTitle.value = song.title || '';
  fieldArtist.value = song.artist || '';
  fieldYoutube.value = song.youtube_id || '';
  fieldDescription.value = song.description || '';
  renderSongList();
  await loadLyricsForCurrentSong();
  showPreview(song.youtube_id);
}

async function loadLyricsForCurrentSong() {
  if (!currentSong || !currentSong.id) { currentLines = []; renderLyricsEditor(); return; }
  const { data, error } = await sb
    .from('meezingvideo_lyrics')
    .select('id, start_seconds, end_seconds, text, line_order')
    .eq('song_id', currentSong.id)
    .order('start_seconds', { ascending: true });
  if (error) { showToast('Tekst laden mislukt: ' + error.message, 'error'); return; }
  currentLines = (data || []).map(function (l) {
    return { id: l.id, start_seconds: Number(l.start_seconds), text: l.text, _existing: true };
  });
  renderLyricsEditor();
}

saveSongBtn.addEventListener('click', async function () {
  const title = fieldTitle.value.trim();
  const artist = fieldArtist.value.trim();
  const youtubeRaw = fieldYoutube.value.trim();
  const description = fieldDescription.value.trim();
  const youtube_id = extractYoutubeId(youtubeRaw);
  if (!title) return showToast('Geef het lied een titel.', 'error');
  if (!youtube_id) return showToast('YouTube link of ID is verplicht.', 'error');
  saveSongBtn.disabled = true;
  saveSongBtn.innerHTML = '<span class="spinner"></span> Opslaan...';
  try {
    if (currentSong && currentSong.id) {
      const { error } = await sb.from('meezingvideo_songs')
        .update({ title: title, artist: artist || null, youtube_id: youtube_id, description: description || null })
        .eq('id', currentSong.id);
      if (error) throw error;
      showToast('Lied bijgewerkt.', 'success');
    } else {
      const { data, error } = await sb.from('meezingvideo_songs')
        .insert({ title: title, artist: artist || null, youtube_id: youtube_id, description: description || null })
        .select('id, title, artist, youtube_id, description').single();
      if (error) throw error;
      currentSong = data;
      showToast('Lied aangemaakt.', 'success');
    }
    await loadSongs();
    if (currentSong && currentSong.id) {
      const fresh = songs.find(function (s) { return s.id === currentSong.id; });
      if (fresh) currentSong = fresh;
      showPreview(currentSong.youtube_id);
      renderSongList();
    }
  } catch (err) {
    showToast('Opslaan mislukt: ' + err.message, 'error');
  } finally {
    saveSongBtn.disabled = false;
    saveSongBtn.innerHTML = 'Opslaan';
  }
});

deleteSongBtn.addEventListener('click', async function () {
  if (!currentSong || !currentSong.id) {
    currentSong = null;
    editor.style.display = 'none';
    editorEmpty.style.display = '';
    return;
  }
  if (!confirm('Weet je zeker dat je "' + currentSong.title + '" wilt verwijderen? Alle teksten gaan ook weg.')) return;
  try {
    const { error } = await sb.from('meezingvideo_songs').delete().eq('id', currentSong.id);
    if (error) throw error;
    showToast('Verwijderd.', 'success');
    currentSong = null;
    editor.style.display = 'none';
    editorEmpty.style.display = '';
    await loadSongs();
  } catch (err) {
    showToast('Verwijderen mislukt: ' + err.message, 'error');
  }
});

function renderLyricsEditor() {
  lyricsEditor.innerHTML = '';
  lineCount.textContent = currentLines.length;
  currentLines.forEach(function (line, idx) {
    const row = document.createElement('div');
    row.className = 'lyric-edit-row';
    row.innerHTML =
      '<input type="text" value="' + escapeHtml(line.start_seconds.toString()) + '" data-field="time" placeholder="seconden of m:ss" />' +
      '<input type="text" value="' + escapeHtml(line.text) + '" data-field="text" placeholder="Tekstregel..." />' +
      '<div style="display:flex; gap:6px;">' +
        '<button class="btn" data-action="seek" title="Spring naar dit moment">&#9654;</button>' +
        '<button class="btn btn-danger" data-action="delete" title="Verwijder">&#10006;</button>' +
      '</div>';
    const inputs = row.querySelectorAll('input');
    inputs[0].addEventListener('change', function (e) { currentLines[idx].start_seconds = parseTimeString(e.target.value); });
    inputs[1].addEventListener('input', function (e) { currentLines[idx].text = e.target.value; });
    row.querySelector('[data-action="seek"]').addEventListener('click', function () {
      if (adminYtPlayer && adminYtPlayer.seekTo) {
        adminYtPlayer.seekTo(currentLines[idx].start_seconds, true);
        adminYtPlayer.playVideo();
      }
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', function () {
      currentLines.splice(idx, 1);
      renderLyricsEditor();
    });
    lyricsEditor.appendChild(row);
  });
  if (!currentLines.length) {
    lyricsEditor.innerHTML = '<div class="helper" style="padding:10px 0;">Nog geen regels. Voeg er een toe of plak meerdere via bulk-import.</div>';
  }
}

addLineBtn.addEventListener('click', function () {
  const now = adminYtPlayer && adminYtPlayer.getCurrentTime ? adminYtPlayer.getCurrentTime() : 0;
  currentLines.push({ start_seconds: Math.round((now || 0) * 100) / 100, text: '' });
  renderLyricsEditor();
  const inputs = lyricsEditor.querySelectorAll('.lyric-edit-row input[data-field="text"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

sortLinesBtn.addEventListener('click', function () {
  currentLines.sort(function (a, b) { return a.start_seconds - b.start_seconds; });
  renderLyricsEditor();
});

captureTimeBtn.addEventListener('click', function () {
  if (!adminYtPlayer || !adminYtPlayer.getCurrentTime) return;
  const t = Math.round(adminYtPlayer.getCurrentTime() * 100) / 100;
  currentLines.push({ start_seconds: t, text: '' });
  renderLyricsEditor();
  const inputs = lyricsEditor.querySelectorAll('.lyric-edit-row input[data-field="text"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

saveLyricsBtn.addEventListener('click', async function () {
  if (!currentSong || !currentSong.id) return showToast('Sla het lied eerst op.', 'error');
  const lines = currentLines
    .map(function (l) { return Object.assign({}, l, { text: (l.text || '').trim() }); })
    .filter(function (l) { return l.text.length > 0; });
  if (!lines.length) {
    if (!confirm('Geen regels - wil je alle bestaande tekst verwijderen?')) return;
  }
  saveLyricsBtn.disabled = true;
  saveLyricsBtn.innerHTML = '<span class="spinner"></span> Opslaan...';
  try {
    const { error: delErr } = await sb.from('meezingvideo_lyrics').delete().eq('song_id', currentSong.id);
    if (delErr) throw delErr;
    if (lines.length) {
      const payload = lines
        .sort(function (a, b) { return a.start_seconds - b.start_seconds; })
        .map(function (l, i) {
          return { song_id: currentSong.id, start_seconds: l.start_seconds, text: l.text, line_order: i };
        });
      const { error: insErr } = await sb.from('meezingvideo_lyrics').insert(payload);
      if (insErr) throw insErr;
    }
    showToast('Songtekst opgeslagen.', 'success');
    await loadLyricsForCurrentSong();
  } catch (err) {
    showToast('Opslaan mislukt: ' + err.message, 'error');
  } finally {
    saveLyricsBtn.disabled = false;
    saveLyricsBtn.innerHTML = 'Songtekst opslaan';
  }
});

bulkParseBtn.addEventListener('click', function () {
  const text = bulkText.value.trim();
  if (!text) return;
  const lines = text.split(/\r?\n/);
  let added = 0;
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (!trimmed) continue;
    const lrc = trimmed.match(/^\[(\d{1,2}:\d{2}(?:\.\d+)?)\]\s*(.+)$/);
    let timeStr, txt;
    if (lrc) { timeStr = lrc[1]; txt = lrc[2]; }
    else {
      const m = trimmed.match(/^(\d+(?::\d+)*(?:\.\d+)?)\s+(.+)$/);
      if (!m) continue;
      timeStr = m[1]; txt = m[2];
    }
    currentLines.push({ start_seconds: parseTimeString(timeStr), text: txt.trim() });
    added++;
  }
  currentLines.sort(function (a, b) { return a.start_seconds - b.start_seconds; });
  renderLyricsEditor();
  if (added) {
    bulkText.value = '';
    showToast(added + ' regel(s) toegevoegd. Klik "Songtekst opslaan" om te bewaren.', 'success');
  } else {
    showToast('Geen regels herkend. Controleer het formaat.', 'error');
  }
});

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

async function showPreview(videoId) {
  if (!videoId) { previewCard.style.display = 'none'; return; }
  previewCard.style.display = '';
  await waitForYTApi();
  if (!adminYtPlayer) {
    adminYtPlayer = new YT.Player('adminYtPlayer', {
      videoId: videoId,
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
      events: { onReady: startAdminPolling, onStateChange: startAdminPolling }
    });
  } else {
    adminYtPlayer.loadVideoById(videoId);
    startAdminPolling();
  }
}
function startAdminPolling() {
  if (adminPollTimer) clearInterval(adminPollTimer);
  adminPollTimer = setInterval(function () {
    if (!adminYtPlayer || !adminYtPlayer.getCurrentTime) return;
    try {
      const t = adminYtPlayer.getCurrentTime();
      currentTimeLabel.textContent = fmtTime(t);
    } catch (_) { }
  }, 250);
}

sb.auth.onAuthStateChange(function (event, session) {
  if (event === 'SIGNED_OUT' || !session) showLogin();
});

checkSession();
