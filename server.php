<?php
/**
 * LocalTube — server.php
 * PHP fallback server (no extensions required)
 * Usage: php server.php
 */

define('PORT', 8080);
define('ROOT', __DIR__);
define('DB_FILE', ROOT . '/database.json');
define('PATHS_FILE', ROOT . '/paths.json');

$VIDEO_EXTS = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'ogv', 'flv', 'wmv', 'ts'];

$MIME_MAP = [
    'mp4'  => 'video/mp4',
    'mkv'  => 'video/x-matroska',
    'webm' => 'video/webm',
    'mov'  => 'video/quicktime',
    'avi'  => 'video/x-msvideo',
    'm4v'  => 'video/x-m4v',
    'ogv'  => 'video/ogg',
    'flv'  => 'video/x-flv',
    'wmv'  => 'video/x-ms-wmv',
    'ts'   => 'video/mp2t',
    'html' => 'text/html',
    'css'  => 'text/css',
    'js'   => 'application/javascript',
    'json' => 'application/json',
    'ico'  => 'image/x-icon',
    'png'  => 'image/png',
];

function read_json($path, $default = []) {
    if (!file_exists($path)) return $default;
    $data = json_decode(file_get_contents($path), true);
    return $data !== null ? $data : $default;
}

function write_json($path, $data) {
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT));
}

function scan_dir_videos($dir, $video_exts) {
    $videos = [];
    if (!is_dir($dir)) return $videos;
    $entries = scandir($dir);
    foreach ($entries as $entry) {
        if ($entry[0] === '.') continue;
        $full = $dir . DIRECTORY_SEPARATOR . $entry;
        if (is_file($full)) {
            $ext = strtolower(pathinfo($entry, PATHINFO_EXTENSION));
            if (in_array($ext, $video_exts)) {
                $stat = stat($full);
                $videos[] = [
                    'name'  => $entry,
                    'path'  => $dir,
                    'size'  => $stat['size'],
                    'mtime' => $stat['mtime'],
                ];
            }
        } elseif (is_dir($full)) {
            $videos = array_merge($videos, scan_dir_videos($full, $video_exts));
        }
    }
    return $videos;
}

// PHP built-in server only handles one request at a time.
// This file is used as a router: php -S 0.0.0.0:8080 server.php
global $VIDEO_EXTS, $MIME_MAP;

$method   = $_SERVER['REQUEST_METHOD'];
$uri      = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$query    = [];
parse_str(parse_url($_SERVER['REQUEST_URI'], PHP_URL_QUERY) ?? '', $query);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: GET,POST,DELETE,OPTIONS');

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function send_json($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function read_body() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return $data ?? [];
}

// ── API ─────────────────────────────────────────────────────────────────

if ($uri === '/api/info' && $method === 'GET') {
    send_json(['runtime' => 'PHP ' . PHP_VERSION, 'port' => PORT]);
}

if ($uri === '/api/paths' && $method === 'GET') {
    send_json(read_json(PATHS_FILE, ['paths' => []]));
}

if ($uri === '/api/paths' && $method === 'POST') {
    $body = read_body();
    write_json(PATHS_FILE, ['paths' => $body['paths'] ?? []]);
    send_json(['ok' => true]);
}

if ($uri === '/api/videos' && $method === 'GET') {
    $scan_path = $query['path'] ?? '';
    if (!$scan_path) send_json(['error' => 'No path'], 400);
    $videos = scan_dir_videos($scan_path, $VIDEO_EXTS);
    send_json(['videos' => $videos]);
}

if ($uri === '/api/stream' && $method === 'GET') {
    $file = urldecode($query['file'] ?? '');
    if (!$file || !file_exists($file)) {
        http_response_code(404); echo 'Not found'; exit;
    }
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    $ct = $MIME_MAP[$ext] ?? 'video/mp4';
    $size = filesize($file);

    if (isset($_SERVER['HTTP_RANGE'])) {
        preg_match('/bytes=(\d+)-(\d*)/', $_SERVER['HTTP_RANGE'], $m);
        $start = (int)$m[1];
        $end = isset($m[2]) && $m[2] !== '' ? (int)$m[2] : min($start + 2 * 1024 * 1024, $size - 1);
        $len = $end - $start + 1;
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
        header('Accept-Ranges: bytes');
        header("Content-Length: $len");
        header("Content-Type: $ct");
        $fp = fopen($file, 'rb');
        fseek($fp, $start);
        $remaining = $len;
        while (!feof($fp) && $remaining > 0) {
            $buf = fread($fp, min(65536, $remaining));
            echo $buf;
            $remaining -= strlen($buf);
        }
        fclose($fp);
        exit;
    } else {
        http_response_code(200);
        header("Content-Length: $size");
        header("Content-Type: $ct");
        header('Accept-Ranges: bytes');
        readfile($file);
        exit;
    }
}

if ($uri === '/api/db' && $method === 'GET') {
    send_json(read_json(DB_FILE, []));
}

if ($uri === '/api/db' && $method === 'POST') {
    $body = read_body();
    write_json(DB_FILE, $body);
    send_json(['ok' => true]);
}

// ── Static ───────────────────────────────────────────────────────────────
$static = ($uri === '/' || $uri === '') ? '/index.html' : $uri;
$file_path = ROOT . $static;

if (file_exists($file_path) && is_file($file_path)) {
    $ext = strtolower(pathinfo($file_path, PATHINFO_EXTENSION));
    $ct = $MIME_MAP[$ext] ?? 'text/plain';
    header("Content-Type: $ct");
    readfile($file_path);
    exit;
}

http_response_code(404);
echo 'Not found';