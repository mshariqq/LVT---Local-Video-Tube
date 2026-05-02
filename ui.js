/**
 * LocalTube — ui.js
 * All DOM rendering, modal control, interactions
 */

const UI = (() => {

  // ─── Loading ───────────────────────────────────────────────────────
  function showLoading() {
    const s = document.getElementById('videoSections');
    if (s) s.innerHTML = `
      <div class="flex items-center justify-center py-24 gap-3 text-white/30">
        <div class="spinner"></div>
        <span class="text-sm">Scanning videos...</span>
      </div>`;
  }

  function hideLoading() {}

  // ─── Sidebar ────────────────────────────────────────────────────────
  function setSidebarActive(id) {
    document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  // ─── Main Render ────────────────────────────────────────────────────
  function render() {
    const grouped = getFilteredVideos();
    const sections = document.getElementById('videoSections');
    const emptyState = document.getElementById('emptyState');
    const heroBar = document.getElementById('heroBar');

    const hasVideos = Object.values(State.videos).some(arr => arr.length > 0);
    const hasPaths = State.paths.length > 0;

    // Stats
    const stats = countStats();
    document.getElementById('statTotal').textContent = stats.total;
    document.getElementById('statFolders').textContent = stats.folders;
    document.getElementById('statLiked').textContent = stats.liked;
    document.getElementById('statComments').textContent = stats.comments;
    document.getElementById('videoCount').textContent = `${stats.total} video${stats.total !== 1 ? 's' : ''}`;

    if (!hasPaths) {
      emptyState.classList.remove('hidden');
      heroBar.classList.add('hidden');
      sections.innerHTML = '';
      return;
    }

    emptyState.classList.add('hidden');
    heroBar.classList.remove('hidden');

    // Render sections
    const pathKeys = Object.keys(grouped);

    if (pathKeys.length === 0) {
      sections.innerHTML = `
        <div class="flex flex-col items-center justify-center py-24 text-center">
          <div class="text-4xl mb-4">🎬</div>
          <h3 class="text-xl font-display font-bold text-white/30 mb-2">No videos found</h3>
          <p class="text-sm text-white/20">${State.filter !== 'all' ? 'Try switching to All Videos' : 'Add more folder paths in Settings'}</p>
        </div>`;
      return;
    }

    let html = '';
    for (const path of pathKeys) {
      const vids = grouped[path];
      if (!vids.length) continue;
      html += renderSection(path, vids);
    }
    sections.innerHTML = html;

    // Attach card click handlers
    document.querySelectorAll('.video-card').forEach(card => {
      card.addEventListener('click', () => {
        const path = card.dataset.path;
        const name = card.dataset.name;
        const vids = State.videos[path] || [];
        const video = vids.find(v => v.name === name);
        if (video) openPlayer(video);
      });
    });

    // Lazy load preview thumbs
    lazyLoadThumbs();
  }

  function renderSection(path, videos) {
    return `
      <div class="mb-12">
        <div class="section-header">
          <div class="section-path-tag">${escapeHtml(path)}</div>
          <div class="section-count">${videos.length} video${videos.length !== 1 ? 's' : ''}</div>
          <div class="section-line"></div>
        </div>
        <div class="video-grid">
          ${videos.map(v => renderCard(v, path)).join('')}
        </div>
      </div>`;
  }

  function renderCard(video, path) {
    const vid = videoId(video);
    const d = getVideoData(vid);
    const title = cleanTitle(video.name);
    const ext = video.name.split('.').pop().toLowerCase();
    const size = formatBytes(video.size);

    return `
      <div class="video-card" data-path="${escapeHtml(path)}" data-name="${escapeHtml(video.name)}">
        <div class="card-thumb" id="thumb-${vid}">
          <img src="" class="thumb-img hidden" alt="" />
          <div class="card-icon">
            <svg width="36" height="36" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24">
              <polygon points="5 3 19 12 5 21 5 3" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)"/>
            </svg>
            <span class="ext-badge">${ext}</span>
          </div>
          <div class="card-thumb-overlay"></div>
          <div class="card-play">
            <svg width="18" height="18" fill="white" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
          ${video.duration ? `<div class="duration-badge">${formatDuration(video.duration)}</div>` : ''}
        </div>
        <div class="card-body">
          <div class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <div class="card-meta">
            <span class="card-size">${size}</span>
            <div class="flex items-center gap-2">
              ${d.liked ? `<span class="card-liked-indicator text-xs">♥</span>` : ''}
              ${d.comments && d.comments.length > 0 ? `<span class="text-white/20 text-xs font-mono">💬 ${d.comments.length}</span>` : ''}
            </div>
          </div>
        </div>
      </div>`;
  }

  function lazyLoadThumbs() {
    document.querySelectorAll('.video-card').forEach(card => {
      const path = card.dataset.path;
      const name = card.dataset.name;
      const vids = State.videos[path] || [];
      const video = vids.find(v => v.name === name);
      if (!video) return;
      
      const vid = videoId(video);
      const img = card.querySelector('.thumb-img');
      const icon = card.querySelector('.card-icon');
      if (!img || img.getAttribute('src')) return;

      img.src = `${API}/thumbnails?vid=${vid}`;
      img.onload = () => {
        img.classList.remove('hidden');
        if (icon) icon.classList.add('hidden');
      };
      img.onerror = () => {
        // Keep icon as fallback
      };
    });
  }

  // ─── Player Modal ────────────────────────────────────────────────────
  function openPlayer(video) {
    State.currentVideo = video;
    const vid = videoId(video);
    const d = getVideoData(vid);
    const title = cleanTitle(video.name);

    // Set video src
    const videoEl = document.getElementById('mainVideo');
    const encodedPath = encodeURIComponent(video.path + '/' + video.name);
    videoEl.src = `${API}/stream?file=${encodedPath}`;
    videoEl.load();

    // Meta
    document.getElementById('videoTitle').textContent = title;
    document.getElementById('videoPath').textContent = video.path;
    document.getElementById('videoSize').textContent = formatBytes(video.size);
    document.getElementById('videoModified').textContent = video.mtime ? formatDate(video.mtime) : '';

    // Like state
    updateLikeBtn(d);

    // Comments
    renderComments(d.comments || []);

    document.getElementById('playerModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closePlayer() {
    const videoEl = document.getElementById('mainVideo');
    videoEl.pause();
    videoEl.src = '';
    document.getElementById('playerModal').classList.add('hidden');
    document.body.style.overflow = '';
    State.currentVideo = null;
  }

  function updateLikeBtn(d) {
    const btn = document.getElementById('likeBtn');
    document.getElementById('likeCount').textContent = d.likes || 0;
    if (d.liked) {
      btn.classList.add('like-active');
    } else {
      btn.classList.remove('like-active');
    }
  }

  function renderComments(comments) {
    const list = document.getElementById('commentsList');
    const label = document.getElementById('commentCountLabel');
    label.textContent = comments.length ? `(${comments.length})` : '';

    if (!comments.length) {
      list.innerHTML = `<p class="text-sm text-white/20 text-center py-6">No comments yet. Be the first!</p>`;
      return;
    }

    list.innerHTML = comments.map(c => `
      <div class="comment-item">
        <div class="comment-avatar">${c.author ? c.author[0].toUpperCase() : 'U'}</div>
        <div class="comment-bubble">
          <div class="comment-meta">${escapeHtml(c.author || 'You')} · ${timeAgo(c.time)}</div>
          <div class="comment-text">${escapeHtml(c.text)}</div>
        </div>
      </div>
    `).join('');
  }

  // ─── Settings Modal ──────────────────────────────────────────────────
  function openSettings() {
    renderPathsList();
    document.getElementById('settingsModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function renderPathsList() {
    const list = document.getElementById('pathsList');
    if (!State.paths.length) {
      list.innerHTML = `<p class="text-xs text-white/25 text-center py-3">No paths added yet</p>`;
      return;
    }
    list.innerHTML = State.paths.map((p, i) => `
      <div class="path-item">
        <span class="truncate">${escapeHtml(p)}</span>
        <button class="remove-btn" onclick="UI.removePath(${i})">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');
  }

  async function addPath() {
    const input = document.getElementById('newPathInput');
    const path = input.value.trim();
    if (!path) return;
    if (State.paths.includes(path)) {
      input.style.borderColor = 'rgba(255,61,61,0.5)';
      setTimeout(() => input.style.borderColor = '', 1500);
      return;
    }
    State.paths.push(path);
    input.value = '';
    await savePaths();
    renderPathsList();

    // Load videos for the new path
    showLoading();
    await loadVideos(path);
    hideLoading();
    render();
  }

  async function removePath(i) {
    const path = State.paths[i];
    State.paths.splice(i, 1);
    delete State.videos[path];
    await savePaths();
    renderPathsList();
    render();
  }

  async function generateThumbnails() {
    const btn = document.getElementById('generateThumbsBtn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Generating...';

    try {
      const res = await fetch(`${API}/thumbnails/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: State.paths }),
      });
      const data = await res.json();
      if (data.ok) {
        alert(`Successfully generated ${data.generated || 0} thumbnails!`);
        render();
      }
    } catch (e) {
      alert('Failed to generate thumbnails: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  // ─── Utils ──────────────────────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDuration(secs) {
    if (!secs) return '';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // ─── Wire up events ──────────────────────────────────────────────────
  function initEvents() {
    // Settings open
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('sidebarSettingsBtn').addEventListener('click', openSettings);
    document.getElementById('emptySettingsBtn').addEventListener('click', openSettings);

    // Settings close
    document.getElementById('closeSettings').addEventListener('click', closeSettings);
    document.getElementById('settingsModal').addEventListener('click', e => {
      if (e.target === document.getElementById('settingsModal')) closeSettings();
    });

    // Add path
    document.getElementById('addPathBtn').addEventListener('click', addPath);
    document.getElementById('newPathInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') addPath();
    });

    // Generate thumbnails
    document.getElementById('generateThumbsBtn').addEventListener('click', generateThumbnails);

    // Player close
    document.getElementById('closePlayer').addEventListener('click', closePlayer);
    document.getElementById('playerModal').addEventListener('click', e => {
      if (e.target === document.getElementById('playerModal')) closePlayer();
    });

    // Keyboard ESC
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (!document.getElementById('playerModal').classList.contains('hidden')) closePlayer();
        else if (!document.getElementById('settingsModal').classList.contains('hidden')) closeSettings();
      }
    });

    // Like button
    document.getElementById('likeBtn').addEventListener('click', async () => {
      if (!State.currentVideo) return;
      const d = await toggleLike(State.currentVideo);
      updateLikeBtn(d);
      render(); // refresh card indicators
    });

    // Fullscreen button
    document.getElementById('fullscreenBtn').addEventListener('click', () => {
      const v = document.getElementById('mainVideo');
      if (v.requestFullscreen) v.requestFullscreen();
      else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen();
      else if (v.mozRequestFullScreen) v.mozRequestFullScreen();
    });

    // Comment submit
    document.getElementById('submitComment').addEventListener('click', submitComment);
    document.getElementById('commentInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') submitComment();
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', e => {
      State.searchQuery = e.target.value;
      render();
    });
  }

  async function submitComment() {
    const input = document.getElementById('commentInput');
    const text = input.value.trim();
    if (!text || !State.currentVideo) return;
    input.value = '';
    await addComment(State.currentVideo, text);
    const vid = videoId(State.currentVideo);
    const d = getVideoData(vid);
    renderComments(d.comments || []);
    render(); // refresh card comment count
  }

  // Init events on DOM ready
  document.addEventListener('DOMContentLoaded', initEvents);

  return {
    render,
    showLoading,
    hideLoading,
    setSidebarActive,
    openSettings,
    closeSettings,
    openPlayer,
    closePlayer,
    addPath,
    removePath,
    renderPathsList,
    escapeHtml,
  };

})();

window.UI = UI;