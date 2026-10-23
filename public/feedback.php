<?php
declare(strict_types=1);

ini_set('display_errors', '0');

require __DIR__ . '/private_path.php';
gap_require_private(__DIR__);
gap_send_security_headers();
gap_start_session();

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method === 'POST' && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 6000) {
    http_response_code(413);
    echo json_encode(['ok' => false, 'error' => 'Shorten the comment and try again.']);
    exit;
}

$raw = $method === 'POST' ? (string) file_get_contents('php://input', false, null, 0, 6001) : '';
if (strlen($raw) > 6000) {
    http_response_code(413);
    echo json_encode(['ok' => false, 'error' => 'Shorten the comment and try again.']);
    exit;
}

$result = gap_handle($_SESSION, $_SERVER, $raw, gap_config(), PRIVATE_DIR . '/throttle', 'gap_deliver', time());
http_response_code($result['status']);
if ($result['status'] === 405) {
    header('Allow: GET, POST');
}
if ($result['status'] === 429) {
    header('Retry-After: 60');
}
echo json_encode($result['body'], JSON_UNESCAPED_UNICODE);
