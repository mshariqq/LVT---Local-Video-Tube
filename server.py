#!/usr/bin/env python3
"""
LocalTube — server.py
Python fallback server (stdlib only)
"""

import http.server
import json
import os
import sys
import mimetypes
import re
import urllib.parse
from pathlib import Path

PORT = 8080
ROOT = Path(__file__).parent.resolve()
DB_FILE = ROOT / 'database.json'
PATHS_FILE = ROOT / 'paths.json'

VIDEO_EXTS = {'.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.ogv', '.flv', '.wmv', '.ts'}

MIME_MAP = {
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
}


def read_json(path, default=None):
    try:
        with open(path, 'r') as f:
            return json.load(f)
    except Exception:
        return default if default is not None else {}


def write_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


def scan_dir(dir_path):
    videos = []
    try:
        for entry in os.scandir(dir_path):
            if entry.name.startswith('.'):
                continue
            if entry.is_file():
                ext = Path(entry.name).suffix.lower()
                if ext in VIDEO_EXTS:
                    stat = entry.stat()
                    videos.append({
                        'name': entry.name,
                        'path': dir_path,
                        'size': stat.st_size,
                        'mtime': int(stat.st_mtime),
                    })
            elif entry.is_dir():
                videos.extend(scan_dir(entry.path))
    except Exception as e:
        print(f'Scan error {dir_path}: {e}', file=sys.stderr)
    return videos


class Handler(http.server.BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        pass  # suppress default logging

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length:
            raw = self.rfile.read(length)
            try:
                return json.loads(raw)
            except Exception:
                return {}
        return {}

    def stream_video(self, file_path):
        try:
            stat = os.stat(file_path)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()
            return

        ext = Path(file_path).suffix.lower()
        content_type = MIME_MAP.get(ext, 'video/mp4')
        total = stat.st_size
        range_header = self.headers.get('Range')

        if range_header:
            match = re.search(r'bytes=(\d+)-(\d*)', range_header)
            start = int(match.group(1))
            end_str = match.group(2)
            end = int(end_str) if end_str else min(start + 2 * 1024 * 1024, total - 1)
            chunk = end - start + 1

            self.send_response(206)
            self.send_header('Content-Range', f'bytes {start}-{end}/{total}')
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', chunk)
            self.send_header('Content-Type', content_type)
            self.cors()
            self.end_headers()

            with open(file_path, 'rb') as f:
                f.seek(start)
                remaining = chunk
                while remaining > 0:
                    buf = f.read(min(65536, remaining))
                    if not buf:
                        break
                    self.wfile.write(buf)
                    remaining -= len(buf)
        else:
            self.send_response(200)
            self.send_header('Content-Length', total)
            self.send_header('Content-Type', content_type)
            self.send_header('Accept-Ranges', 'bytes')
            self.cors()
            self.end_headers()
            with open(file_path, 'rb') as f:
                while True:
                    buf = f.read(65536)
                    if not buf:
                        break
                    self.wfile.write(buf)

    def serve_static(self, file_path):
        ext = Path(file_path).suffix.lower()
        ctype = mimetypes.types_map.get(ext, 'text/plain')
        try:
            with open(file_path, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', len(data))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        def q(key):
            v = query.get(key, [None])
            return v[0] if v else None

        if path == '/api/info':
            self.send_json({'runtime': f'Python {sys.version.split()[0]}', 'port': PORT})

        elif path == '/api/paths':
            data = read_json(PATHS_FILE, {'paths': []})
            self.send_json(data)

        elif path == '/api/videos':
            scan_path = q('path')
            if not scan_path:
                self.send_json({'error': 'No path'}, 400)
                return
            videos = scan_dir(scan_path)
            self.send_json({'videos': videos})

        elif path == '/api/stream':
            file_path = q('file') or ''
            file_path = urllib.parse.unquote(file_path)
            if not file_path:
                self.send_response(400); self.end_headers(); return
            self.stream_video(file_path)

        elif path == '/api/db':
            self.send_json(read_json(DB_FILE, {}))

        else:
            # Static
            static_rel = path if path != '/' else '/index.html'
            static_file = ROOT / static_rel.lstrip('/')
            if static_file.is_file() and str(static_file).startswith(str(ROOT)):
                self.serve_static(static_file)
            else:
                self.send_response(404); self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/paths':
            body = self.read_body()
            write_json(PATHS_FILE, {'paths': body.get('paths', [])})
            self.send_json({'ok': True})

        elif path == '/api/db':
            body = self.read_body()
            write_json(DB_FILE, body)
            self.send_json({'ok': True})

        else:
            self.send_response(404); self.end_headers()


if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', PORT), Handler)
    print(f'\n  🎬  LocalTube is running!')
    print(f'  ➜  http://localhost:{PORT}\n')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')