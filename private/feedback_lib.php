<?php
declare(strict_types=1);

const GAP_DEFAULT_FROM = 'noreply@betterschools.com.au';
const GAP_MAX_BODY = 6000;
const GAP_HOUR = 3600;
const GAP_MIN_GAP = 10;
const GAP_IP_LIMIT = 30;
const GAP_SESSION_LIMIT = 20;

function gap_fail(int $status, string $message): array
{
    return ['status' => $status, 'body' => ['ok' => false, 'error' => $message]];
}

function gap_ok(string $message): array
{
    return ['status' => 200, 'body' => ['ok' => true, 'message' => $message]];
}

function gap_origin(array $server): string
{
    $https = !empty($server['HTTPS']) && $server['HTTPS'] !== 'off';
    $host = (string) ($server['HTTP_HOST'] ?? '');
    if ($host === '' || preg_match('/[\r\n\s]/', $host)) {
        return '';
    }
    return ($https ? 'https' : 'http') . '://' . $host;
}

function gap_same_origin(array $server): bool
{
    $fetch = (string) ($server['HTTP_SEC_FETCH_SITE'] ?? 'same-origin');
    if ($fetch !== 'same-origin') {
        return false;
    }
    $expected = gap_origin($server);
    if ($expected === '') {
        return false;
    }
    $origin = (string) ($server['HTTP_ORIGIN'] ?? '');
    if ($origin !== '' && $origin !== $expected) {
        return false;
    }
    $referer = (string) ($server['HTTP_REFERER'] ?? '');
    if ($referer !== '' && !str_starts_with($referer, $expected . '/') && $referer !== $expected) {
        return false;
    }
    return true;
}

function gap_header_safe(string $value): bool
{
    return $value !== '' && !preg_match('/[\r\n]/', $value);
}

function gap_valid_email(string $value): bool
{
    if (strlen($value) > 254 || !gap_header_safe($value)) {
        return false;
    }
    return filter_var($value, FILTER_VALIDATE_EMAIL) !== false;
}

function gap_clean_line(string $value, int $max): string
{
    $value = trim(str_replace(["\r", "\n"], ' ', $value));
    if (strlen($value) > $max) {
        $value = substr($value, 0, $max);
    }
    return $value;
}

function gap_clean_comment(string $value): string
{
    $value = str_replace("\r\n", "\n", $value);
    $value = str_replace("\r", "\n", $value);
    $value = trim($value);
    if (strlen($value) > 1500) {
        $value = substr($value, 0, 1500);
    }
    return $value;
}

function gap_mail_identity(array $config): array
{
    $to = $config['FEEDBACK_TO'] ?? '';
    $from = $config['FEEDBACK_FROM'] ?? GAP_DEFAULT_FROM;
    if (!is_string($to) || !is_string($from)) {
        return gap_fail(503, 'Feedback email is not configured.');
    }
    $to = trim($to);
    $from = trim($from);
    if ($from === '') {
        $from = GAP_DEFAULT_FROM;
    }
    if ($to === '' || !gap_valid_email($to) || !gap_valid_email($from)) {
        return gap_fail(503, 'Feedback email is not configured.');
    }
    return ['to' => $to, 'from' => $from];
}

function gap_student_key(string $key): bool
{
    return (bool) preg_match('/student|marks|school|class\b|localstorage|surname|fullname/i', $key);
}

function gap_validate_payload(array $input): array
{
    $allowed = [
        'kind' => true,
        'comment' => true,
        'teacherName' => true,
        'teacherEmail' => true,
        'topicId' => true,
        'topicName' => true,
        'prerequisiteId' => true,
        'prerequisiteName' => true,
        'strength' => true,
        'reason' => true,
        'company' => true,
    ];
    foreach ($input as $key => $_value) {
        if (!is_string($key) || !isset($allowed[$key]) || gap_student_key($key)) {
            return gap_fail(422, 'This form cannot include student information.');
        }
    }
    $kind = $input['kind'] ?? '';
    if ($kind !== 'link' && $kind !== 'general') {
        return gap_fail(422, 'Choose the feedback you want to send.');
    }
    $comment = gap_clean_comment((string) ($input['comment'] ?? ''));
    if ($comment === '') {
        return gap_fail(422, 'Write a short comment so we know what to look at.');
    }
    $teacherName = gap_clean_line((string) ($input['teacherName'] ?? ''), 80);
    if ($teacherName !== '' && !preg_match("/^[\\p{L}][\\p{L} .'\\-]{0,79}$/u", $teacherName)) {
        return gap_fail(422, 'The name can use letters only, or leave it blank.');
    }
    $teacherEmail = trim((string) ($input['teacherEmail'] ?? ''));
    if ($teacherEmail !== '' && !gap_valid_email($teacherEmail)) {
        return gap_fail(422, 'Enter a valid email, or leave it blank.');
    }
    $company = (string) ($input['company'] ?? '');
    $payload = [
        'kind' => $kind,
        'comment' => $comment,
        'teacherName' => $teacherName,
        'teacherEmail' => $teacherEmail,
        'company' => $company,
        'topicId' => '',
        'topicName' => '',
        'prerequisiteId' => '',
        'prerequisiteName' => '',
        'strength' => '',
        'reason' => '',
    ];
    if ($kind === 'general') {
        foreach (['topicId', 'topicName', 'prerequisiteId', 'prerequisiteName', 'strength', 'reason'] as $key) {
            if (trim((string) ($input[$key] ?? '')) !== '') {
                return gap_fail(422, 'This form cannot include student information.');
            }
        }
        return ['payload' => $payload];
    }
    $topicId = (string) ($input['topicId'] ?? '');
    $prereqId = (string) ($input['prerequisiteId'] ?? '');
    if (!preg_match('/^mt_[A-Za-z0-9_-]{10}$/', $topicId) || !preg_match('/^mt_[A-Za-z0-9_-]{10}$/', $prereqId)) {
        return gap_fail(422, 'Choose a prerequisite link first.');
    }
    $topicName = gap_clean_line((string) ($input['topicName'] ?? ''), 80);
    $prereqName = gap_clean_line((string) ($input['prerequisiteName'] ?? ''), 80);
    if ($topicName === '' || $prereqName === '') {
        return gap_fail(422, 'Choose a prerequisite link first.');
    }
    $strength = (string) ($input['strength'] ?? '');
    if ($strength !== 'hard' && $strength !== 'helpful') {
        return gap_fail(422, 'Choose a prerequisite link first.');
    }
    $payload['topicId'] = $topicId;
    $payload['topicName'] = $topicName;
    $payload['prerequisiteId'] = $prereqId;
    $payload['prerequisiteName'] = $prereqName;
    $payload['strength'] = $strength;
    $payload['reason'] = gap_clean_line((string) ($input['reason'] ?? ''), 400);
    return ['payload' => $payload];
}

function gap_compose_message(array $payload): string
{
    $lines = [
        'Better Schools Gap Finder',
        'Feedback about the Marble Skill Taxonomy prerequisite map.',
        '',
        'This is a starting point, not a diagnosis.',
        'No student information is included in this message.',
        '',
    ];
    if ($payload['kind'] === 'link') {
        $lines[] = 'Kind: Prerequisite link';
        $lines[] = 'Skill: ' . $payload['topicName'];
        $lines[] = 'Skill ID: ' . $payload['topicId'];
        $lines[] = 'Prerequisite: ' . $payload['prerequisiteName'];
        $lines[] = 'Prerequisite ID: ' . $payload['prerequisiteId'];
        $lines[] = 'Link strength: ' . ($payload['strength'] === 'hard' ? 'essential' : 'helpful');
        $lines[] = 'Stated reason: ' . ($payload['reason'] !== '' ? $payload['reason'] : '(none)');
    } else {
        $lines[] = 'Kind: General feedback';
    }
    $lines[] = '';
    $lines[] = 'Comment:';
    $lines[] = $payload['comment'];
    $lines[] = '';
    $lines[] = 'Teacher name: ' . ($payload['teacherName'] !== '' ? $payload['teacherName'] : '(not given)');
    $lines[] = 'Teacher email: ' . ($payload['teacherEmail'] !== '' ? $payload['teacherEmail'] : '(not given)');
    $lines[] = '';
    $lines[] = '---';
    $lines[] = 'Marble Skill Taxonomy (v1) · © Generative Spark, Inc. (Marble)';
    $lines[] = 'https://withmarble.com';
    $lines[] = 'Database: ODbL 1.0 · Content: CC BY-SA 4.0';
    $lines[] = 'Source: https://github.com/withmarbleapp/os-taxonomy';
    return implode("\n", $lines);
}

function gap_rate_limited(string $dir, string $bucket, int $now, int $limit): bool
{
    if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
        return true;
    }
    $path = $dir . '/' . hash('sha256', $bucket) . '.json';
    $handle = fopen($path, 'c+');
    if ($handle === false) {
        return true;
    }
    try {
        if (!flock($handle, LOCK_EX)) {
            return true;
        }
        $raw = stream_get_contents($handle);
        $times = json_decode($raw === false || $raw === '' ? '[]' : $raw, true);
        if (!is_array($times)) {
            $times = [];
        }
        $kept = [];
        foreach ($times as $stamp) {
            if (is_int($stamp) && $stamp > $now - GAP_HOUR) {
                $kept[] = $stamp;
            }
        }
        $limited = count($kept) >= $limit || ($kept !== [] && $now - $kept[count($kept) - 1] < GAP_MIN_GAP);
        if (!$limited) {
            $kept[] = $now;
            rewind($handle);
            ftruncate($handle, 0);
            fwrite($handle, json_encode($kept));
            fflush($handle);
        }
        flock($handle, LOCK_UN);
    } finally {
        fclose($handle);
    }
    @chmod($path, 0600);
    return $limited;
}

function gap_deliver(string $to, string $subject, string $body, string $from, string $replyTo): bool
{
    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'From: Better Schools Gap Finder <' . $from . '>',
    ];
    if ($replyTo !== '') {
        $headers[] = 'Reply-To: ' . $replyTo;
    }
    $params = '-f' . $from;
    return mail($to, $subject, $body, implode("\r\n", $headers), $params);
}

/**
 * @param array<string,mixed> $session
 * @param array<string,mixed> $server
 * @param callable(string,string,string,string,string):bool $deliver
 * @return array{status:int,body:array<string,mixed>}
 */
function gap_handle(array &$session, array $server, string $raw, array $config, string $throttleDir, callable $deliver, int $now): array
{
    $method = strtoupper((string) ($server['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'GET') {
        if (empty($session['csrf']) || !is_string($session['csrf'])) {
            $session['csrf'] = bin2hex(random_bytes(32));
        }
        return ['status' => 200, 'body' => ['ok' => true, 'csrf' => $session['csrf']]];
    }
    if ($method !== 'POST') {
        return gap_fail(405, 'Use the feedback form on the Gap Finder page.');
    }
    if (!gap_same_origin($server)) {
        return gap_fail(403, 'Use the feedback form on the Gap Finder page.');
    }
    $token = (string) ($server['HTTP_X_CSRF_TOKEN'] ?? '');
    $csrf = (string) ($session['csrf'] ?? '');
    if ($csrf === '' || $token === '' || !hash_equals($csrf, $token)) {
        return gap_fail(403, 'Reload the page and try again.');
    }
    $contentType = strtolower(trim(explode(';', (string) ($server['CONTENT_TYPE'] ?? ''))[0]));
    if ($contentType !== 'application/json') {
        return gap_fail(415, 'Send the feedback form again.');
    }
    if (strlen($raw) > GAP_MAX_BODY) {
        return gap_fail(413, 'Shorten the comment and try again.');
    }
    try {
        $input = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return gap_fail(422, 'Send the feedback form again.');
    }
    if (!is_array($input) || array_is_list($input)) {
        return gap_fail(422, 'Send the feedback form again.');
    }
    $validated = gap_validate_payload($input);
    if (isset($validated['status'])) {
        return $validated;
    }
    $payload = $validated['payload'];
    $honeypot = trim($payload['company']) !== '';
    $identity = $honeypot ? [] : gap_mail_identity($config);
    if (!$honeypot && isset($identity['status'])) {
        return $identity;
    }
    $ip = (string) ($server['REMOTE_ADDR'] ?? 'unknown');
    $sessionKey = (string) ($session['rateKey'] ?? '');
    if ($sessionKey === '') {
        $sessionKey = bin2hex(random_bytes(16));
        $session['rateKey'] = $sessionKey;
    }
    $limited = gap_rate_limited($throttleDir, 'ip|' . $ip, $now, GAP_IP_LIMIT)
        || gap_rate_limited($throttleDir, 'session|' . $sessionKey, $now, GAP_SESSION_LIMIT);
    if ($honeypot) {
        return gap_ok('Thank you. Your note was sent.');
    }
    if ($limited) {
        return gap_fail(429, 'Please wait a little while before sending another note.');
    }
    $body = gap_compose_message($payload);
    $sent = $deliver($identity['to'], 'Gap Finder feedback', $body, $identity['from'], $payload['teacherEmail']);
    if (!$sent) {
        return gap_fail(502, 'The note could not be sent. Try again shortly.');
    }
    return gap_ok('Thank you. Your note was sent.');
}
