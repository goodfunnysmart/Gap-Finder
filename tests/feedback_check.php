<?php
declare(strict_types=1);

require dirname(__DIR__) . '/private/feedback_lib.php';

$failed = 0;
function check(bool $ok, string $message): void
{
    global $failed;
    if ($ok) {
        fwrite(STDOUT, "ok  $message\n");
        return;
    }
    $failed++;
    fwrite(STDERR, "FAIL $message\n");
}

$example = require dirname(__DIR__) . '/private/config.example.php';
check($example['FEEDBACK_TO'] === 'info@betterschools.com.au', 'example config uses the public feedback address');
check($example['FEEDBACK_FROM'] === 'noreply@betterschools.com.au', 'example config sends from noreply@betterschools.com.au');

$php = file_get_contents(dirname(__DIR__) . '/private/feedback_lib.php') . file_get_contents(dirname(__DIR__) . '/public/feedback.php');
check(!str_contains($php, 'info@betterschools.com.au'), 'the mailer reads the recipient from config and does not hardcode it');
check(!str_contains($php, 'david@') && !str_contains($php, 'cubedigital'), 'no private recipient is hardcoded');

function server(string $method, array $extra = []): array
{
    return $extra + [
        'REQUEST_METHOD' => $method,
        'HTTP_HOST' => 'gap-finder.test',
        'HTTPS' => 'on',
        'HTTP_SEC_FETCH_SITE' => 'same-origin',
        'HTTP_ORIGIN' => 'https://gap-finder.test',
        'CONTENT_TYPE' => 'application/json',
        'REMOTE_ADDR' => '203.0.113.10',
    ];
}

function post(array &$session, string $json, array $config, string $dir, array $server, int $now, array &$sent): array
{
    $deliver = function (string $to, string $subject, string $body, string $from, string $reply) use (&$sent): bool {
        $sent[] = compact('to', 'subject', 'body', 'from', 'reply');
        return true;
    };
    return gap_handle($session, $server, $json, $config, $dir, $deliver, $now);
}

$dir = sys_get_temp_dir() . '/gap-finder-throttle-' . bin2hex(random_bytes(4));
mkdir($dir, 0700);
$session = [];
$get = gap_handle($session, server('GET'), '', $example, $dir, fn() => false, 1_700_000_000);
check($get['status'] === 200 && is_string($get['body']['csrf']) && strlen($get['body']['csrf']) === 64, 'GET issues a CSRF token');
$token = $get['body']['csrf'];

$sent = [];
$denied = post($session, '{"kind":"general","comment":"Hello there","company":""}', $example, $dir, server('POST'), 1_700_000_000, $sent);
check($denied['status'] === 403 && $sent === [], 'POST without the token is rejected');

$server = server('POST', ['HTTP_X_CSRF_TOKEN' => $token]);
$sent = [];
$cross = post($session, '{"kind":"general","comment":"Hello there","company":""}', $example, $dir, server('POST', [
    'HTTP_X_CSRF_TOKEN' => $token,
    'HTTP_SEC_FETCH_SITE' => 'cross-site',
    'HTTP_ORIGIN' => 'https://evil.example',
]), 1_700_000_000, $sent);
check($cross['status'] === 403 && $sent === [], 'cross-origin POST is rejected');

$sent = [];
$student = post($session, '{"kind":"general","comment":"Hello there","students":[{"name":"Sam"}],"company":""}', $example, $dir, $server, 1_700_000_000, $sent);
check($student['status'] === 422 && $sent === [], 'student fields are rejected and not mailed');

$sent = [];
$honeypot = post($session, '{"kind":"general","comment":"Hello there","company":"https://spam.example"}', $example, $dir, $server, 1_700_000_100, $sent);
check($honeypot['status'] === 200 && $honeypot['body']['ok'] === true && $sent === [], 'honeypot pretends to succeed and does not mail');

$sent = [];
$comment = 'The denominator step is missing for this class of question.';
$bodyJson = json_encode([
    'kind' => 'link',
    'comment' => $comment,
    'teacherName' => 'Alex',
    'teacherEmail' => 'alex@example.com',
    'topicId' => 'mt_-V7EnqU7gG',
    'topicName' => 'Adding fractions (different denominators)',
    'prerequisiteId' => 'mt_0123456789',
    'prerequisiteName' => 'Equivalent fractions',
    'strength' => 'hard',
    'reason' => 'Shared denominators come first',
    'company' => '',
], JSON_THROW_ON_ERROR);
$ok = post($session, $bodyJson, $example, $dir, $server, 1_700_000_200, $sent);
check($ok['status'] === 200 && count($sent) === 1, 'a link note is mailed');
if ($sent) {
    $mail = $sent[0];
    check($mail['to'] === 'info@betterschools.com.au', 'mail goes to the config recipient');
    check($mail['from'] === 'noreply@betterschools.com.au', 'mail is sent from noreply@betterschools.com.au');
    check($mail['reply'] === 'alex@example.com', 'teacher email is the reply-to address');
    check(str_contains($mail['body'], 'mt_-V7EnqU7gG'), 'mail includes the skill id');
    check(str_contains($mail['body'], 'Equivalent fractions'), 'mail includes the prerequisite name');
    check(str_contains($mail['body'], 'ODbL 1.0') && str_contains($mail['body'], 'CC BY-SA 4.0'), 'mail includes the Marble licence');
    check(str_contains($mail['body'], 'https://withmarble.com') && str_contains($mail['body'], 'https://github.com/withmarbleapp/os-taxonomy'), 'mail includes the Marble links');
    check(str_contains($mail['body'], 'Starting point, not a diagnosis') || str_contains($mail['body'], 'starting point, not a diagnosis'), 'mail includes the diagnosis note');
    check(!str_contains($mail['body'], 'Sam') && !str_contains($mail['body'], 'marks'), 'mail does not include a student record');
}

$sent = [];
$override = ['FEEDBACK_TO' => 'elsewhere@example.com', 'FEEDBACK_FROM' => 'noreply@betterschools.com.au'];
$again = post($session, '{"kind":"general","comment":"A general note about the wording.","teacherName":"","teacherEmail":"","company":""}', $override, $dir, $server, 1_700_000_220, $sent);
check($again['status'] === 200 && ($sent[0]['to'] ?? '') === 'elsewhere@example.com', 'a private config can choose a different recipient');

$sent = [];
$injected = post($session, '{"kind":"general","comment":"Hello there","teacherEmail":"a@example.com\nBcc: leak@example.com","company":""}', $example, $dir, $server, 1_700_000_240, $sent);
check($injected['status'] === 422 && $sent === [], 'header injection in the email is rejected');

$sent = [];
$limited = post($session, '{"kind":"general","comment":"Too soon","company":""}', $example, $dir, $server, 1_700_000_225, $sent);
check($limited['status'] === 429 && $sent === [], 'a second note in the same few seconds is rate limited');

$sent = [];
$unconfigured = post($session, '{"kind":"general","comment":"Hello there","company":""}', [], $dir, $server, 1_700_000_400, $sent);
check($unconfigured['status'] === 503 && $sent === [], 'feedback is refused when the private config has no recipient');

if ($failed) {
    fwrite(STDERR, "$failed failed\n");
    exit(1);
}
fwrite(STDOUT, "feedback checks passed\n");
