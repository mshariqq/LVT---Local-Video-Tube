/**
 * LocalTube — app.js
 * Core: state, API calls, data management
 */

const API = 'http://localhost:8080/api';

// ─── State ─────────────────────────────────────────────────────────────
const State = {
  paths: [],
  videos: {},       // { path: [videoObj, ...] }
  db: {},           // { videoId: { likes: 0, comments: [] } }
  currentVideo: null,
  filter: 'all',    // all | recent | liked
  searchQuery: '',
};

// ─── Stable UID ─────────────────────────────────────────────────────────
// Based on filename + size only — survives folder moves.
// Uses a fast djb2-style hash so it's purely deterministic with no
// async work needed at render time.
function videoId(video) {
  const key = video.name + ':' + (video.size || 0);
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h) ^ key.charCodeAt(i);
    h = h >>> 0; // keep unsigned 32-bit
  }
  return 'v_' + h.toString(36);
}

// Legacy key format (used before this change): btoa(path/name) without '='
function _legacyId(video) {
  try { return btoa(video.path + '/' + video.name).replace(/=/g, ''); }
  catch { return null; }
}

// One-time migration: rewrite any old path-based keys to stable UIDs.
// Called after both DB and videos are loaded.
function migrateDB() {
  let dirty = false;
  // Build a lookup: legacyId -> video object, for every known video
  const legacyMap = {};
  for (const path of State.paths) {
    for (const v of (State.videos[path] || [])) {
      const lid = _legacyId(v);
      if (lid) legacyMap[lid] = v;
    }
  }
  for (const oldKey of Object.keys(State.db)) {
    // Already a stable key (starts with 'v_')
    if (oldKey.startsWith('v_')) continue;
    const video = legacyMap[oldKey];
    if (!video) continue; // orphan legacy key — leave it, don't delete
    const newKey = videoId(video);
    if (!State.db[newKey]) {
      State.db[newKey] = State.db[oldKey];
    }
    delete State.db[oldKey];
    dirty = true;
  }
  if (dirty) saveDB();
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function cleanTitle(filename) {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[._\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── API calls ──────────────────────────────────────────────────────────
async function apiFetch(endpoint, opts = {}) {
  try {
    const res = await fetch(API + endpoint, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('API error:', endpoint, e.message);
    return null;
  }
}

async function loadPaths() {
  const data = await apiFetch('/paths');
  if (data) State.paths = data.paths || [];
  return State.paths;
}

async function savePaths() {
  await apiFetch('/paths', {
    method: 'POST',
    body: JSON.stringify({ paths: State.paths }),
  });
}

async function loadVideos(path) {
  const data = await apiFetch('/videos?path=' + encodeURIComponent(path));
  if (data && data.videos) {
    State.videos[path] = data.videos;
  } else {
    State.videos[path] = [];
  }
  return State.videos[path];
}

async function loadAllVideos() {
  const promises = State.paths.map(p => loadVideos(p));
  await Promise.all(promises);
}

async function loadDB() {
  const data = await apiFetch('/db');
  if (data) State.db = data;
}

async function saveDB() {
  await apiFetch('/db', {
    method: 'POST',
    body: JSON.stringify(State.db),
  });
}

function getVideoData(vid) {
  if (!State.db[vid]) {
    State.db[vid] = { likes: 0, liked: false, comments: [] };
  }
  return State.db[vid];
}

async function toggleLike(video) {
  const vid = videoId(video);
  const d = getVideoData(vid);
  d.liked = !d.liked;
  d.likes = d.liked ? d.likes + 1 : Math.max(0, d.likes - 1);
  await saveDB();
  return d;
}

async function addComment(video, text) {
  const vid = videoId(video);
  const d = getVideoData(vid);
  const comment = {
    id: Date.now(),
    text: text.trim(),
    time: Date.now(),
    author: 'You',
  };
  d.comments.unshift(comment);
  await saveDB();
  return comment;
}

// ─── Filter / Search ────────────────────────────────────────────────────
function getFilteredVideos() {
  const q = State.searchQuery.toLowerCase();

  // Flatten all videos with their path
  let all = [];
  for (const path of State.paths) {
    const vids = (State.videos[path] || []).map(v => ({ ...v, folderPath: path }));
    all = all.concat(vids);
  }

  // Search
  if (q) {
    all = all.filter(v => cleanTitle(v.name).toLowerCase().includes(q) || v.name.toLowerCase().includes(q));
  }

  // Filter
  if (State.filter === 'recent') {
    all = all.sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, 20);
  } else if (State.filter === 'liked') {
    all = all.filter(v => {
      const d = State.db[videoId(v)];
      return d && d.liked;
    });
  }

  // Group back by path
  const grouped = {};
  for (const v of all) {
    if (!grouped[v.folderPath]) grouped[v.folderPath] = [];
    grouped[v.folderPath].push(v);
  }
  return grouped;
}

function countStats() {
  let total = 0, liked = 0, comments = 0;
  for (const path of State.paths) {
    const vids = State.videos[path] || [];
    total += vids.length;
    for (const v of vids) {
      const d = State.db[videoId(v)];
      if (d) {
        if (d.liked) liked++;
        comments += (d.comments || []).length;
      }
    }
  }
  return { total, folders: State.paths.length, liked, comments };
}

// ─── Initialise ─────────────────────────────────────────────────────────
async function init() {
  // Detect runtime from server
  apiFetch('/info').then(data => {
    if (data && data.runtime) {
      const el = document.getElementById('serverRuntime');
      if (el) el.textContent = data.runtime;
    }
  });

  await loadDB();
  await loadPaths();

  if (State.paths.length > 0) {
    UI.showLoading();
    await loadAllVideos();
    UI.hideLoading();
    // Migrate any legacy path-based keys to stable name+size UIDs
    migrateDB();
  }

  UI.render();
}

// kick off
window.addEventListener('DOMContentLoaded', init);

// expose globally for UI
window.State = State;
window.videoId = videoId;
window.formatBytes = formatBytes;
window.formatDate = formatDate;
window.cleanTitle = cleanTitle;
window.timeAgo = timeAgo;
window.loadVideos = loadVideos;
window.migrateDB = migrateDB;
window.loadAllVideos = loadAllVideos;
window.savePaths = savePaths;
window.loadPaths = loadPaths;
window.loadDB = loadDB;
window.getVideoData = getVideoData;
window.toggleLike = toggleLike;
window.addComment = addComment;
window.countStats = countStats;
window.getFilteredVideos = getFilteredVideos;
window.API = API;

// sidebar filter fns (called from HTML)
function filterAll() { State.filter = 'all'; UI.setSidebarActive('btn-all'); UI.render(); }
function filterRecent() { State.filter = 'recent'; UI.setSidebarActive('btn-recent'); UI.render(); }
function filterLiked() { State.filter = 'liked'; UI.setSidebarActive('btn-liked'); UI.render(); }
window.filterAll = filterAll;
window.filterRecent = filterRecent;
window.filterLiked = filterLiked;