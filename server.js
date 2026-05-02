#!/usr/bin/env node
/**
 * LocalTube — server.js
 * Node.js HTTP server (no dependencies beyond stdlib)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { execSync } = require('child_process');

const PORT = 8080;
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'database.json');
const PATHS_FILE = path.join(ROOT, 'paths.json');
const THUMBS_DIR = path.join(ROOT, 'thumbnails');

if (!fs.existsSync(THUMBS_DIR)) {
  fs.mkdirSync(THUMBS_DIR, { recursive: true });
}

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.ogv', '.flv', '.wmv', '.ts']);

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/x-m4v',
  '.ogv': 'video/ogg',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.ts': 'video/mp2t',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

// ─── DB helpers ────────────────────────────────────────────────────────
function readJSON(file, def = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return def;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Directory scanner ─────────────────────────────────────────────────
function scanDir(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const videos = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (VIDEO_EXTS.has(ext)) {
          const fullPath = path.join(dirPath, entry.name);
          let stat;
          try { stat = fs.statSync(fullPath); } catch { continue; }
          videos.push({
            name: entry.name,
            path: dirPath,
            size: stat.size,
            mtime: Math.floor(stat.mtimeMs / 1000),
          });
        }
      } else if (entry.isDirectory()) {
        // Recurse one level deep
        const sub = scanDir(path.join(dirPath, entry.name));
        videos.push(...sub);
      }
    }

    return videos;
  } catch (e) {
    console.error('Scan error:', dirPath, e.message);
    return [];
  }
}

// ─── Range-aware stream for video ──────────────────────────────────────
function streamVideo(req, res, filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404);
    res.end('File not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'video/mp4';
  const total = stat.size;

  const rangeHeader = req.headers['range'];
  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024 * 2, total - 1);
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

// ─── Thumbnail generation ───────────────────────────────────────────────
function generateThumbnail(filePath, vid) {
  const thumbPath = path.join(THUMBS_DIR, `${vid}.jpg`);
  if (fs.existsSync(thumbPath)) return true;

  try {
    // Capture frame at 1 second or 10% of video
    const cmd = `ffmpeg -ss 00:00:01 -i "${filePath}" -vframes 1 -q:v 2 -vf "scale=320:-1" "${thumbPath}" -y`;
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch (e) {
    console.error('FFmpeg error for', filePath, e.message);
    return false;
  }
}

// ─── Response helpers ──────────────────────────────────────────────────
function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ─── Static file server ────────────────────────────────────────────────
function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'text/plain';
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

// ─── Router ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── API routes ──────────────────────────────────────────────────────

  // GET /api/info
  if (pathname === '/api/info' && method === 'GET') {
    json(res, { runtime: 'Node.js ' + process.version, port: PORT });
    return;
  }

  // GET /api/paths
  if (pathname === '/api/paths' && method === 'GET') {
    const data = readJSON(PATHS_FILE, { paths: [] });
    json(res, data);
    return;
  }

  // POST /api/paths
  if (pathname === '/api/paths' && method === 'POST') {
    const body = await readBody(req);
    writeJSON(PATHS_FILE, { paths: body.paths || [] });
    json(res, { ok: true });
    return;
  }

  // GET /api/videos?path=...
  if (pathname === '/api/videos' && method === 'GET') {
    const scanPath = query.path;
    if (!scanPath) { json(res, { error: 'No path' }, 400); return; }
    const videos = scanDir(scanPath);
    json(res, { videos });
    return;
  }

  // GET /api/stream?file=...
  if (pathname === '/api/stream' && method === 'GET') {
    const filePath = decodeURIComponent(query.file || '');
    if (!filePath) { res.writeHead(400); res.end('No file'); return; }
    streamVideo(req, res, filePath);
    return;
  }

  // GET /api/db
  if (pathname === '/api/db' && method === 'GET') {
    const data = readJSON(DB_FILE, {});
    json(res, data);
    return;
  }

    // POST /api/db
    if (pathname === '/api/db' && method === 'POST') {
      const body = await readBody(req);
      writeJSON(DB_FILE, body);
      json(res, { ok: true });
      return;
    }

    // POST /api/thumbnails/generate
    if (pathname === '/api/thumbnails/generate' && method === 'POST') {
      const { paths } = await readBody(req);
      if (!paths) { json(res, { error: 'No paths' }, 400); return; }

      let count = 0;
      for (const p of paths) {
        const videos = scanDir(p);
        for (const v of videos) {
          // We need to replicate the videoId logic here to name the thumb
          // Or we can just ask the frontend to send a list of (path, name, size, hash)
          // But let's just use a simple hash here that matches frontend.
          const key = v.name + ':' + (v.size || 0);
          let h = 5381;
          for (let i = 0; i < key.length; i++) {
            h = ((h << 5) + h) ^ key.charCodeAt(i);
            h = h >>> 0;
          }
          const vid = 'v_' + h.toString(36);
          if (generateThumbnail(path.join(p, v.name), vid)) {
            count++;
          }
        }
      }
      json(res, { ok: true, generated: count });
      return;
    }

    // GET /api/thumbnails?vid=...
    if (pathname === '/api/thumbnails' && method === 'GET') {
      const vid = query.vid;
      if (!vid) { res.writeHead(400); res.end('No vid'); return; }
      const thumbPath = path.join(THUMBS_DIR, `${vid}.jpg`);
      if (fs.existsSync(thumbPath)) {
        serveStatic(res, thumbPath);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }

    // ── Static files ────────────────────────────────────────────────────


  let staticPath = pathname === '/' ? '/index.html' : pathname;
  staticPath = path.join(ROOT, staticPath);

  // Safety: must stay in ROOT
  if (!staticPath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    serveStatic(res, staticPath);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🎬  LocalTube is running!');
  console.log(`  ➜  http://localhost:${PORT}\n`);
});