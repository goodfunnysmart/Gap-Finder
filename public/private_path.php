<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli' && isset($_SERVER['SCRIPT_FILENAME'])) {
    $script = realpath((string) $_SERVER['SCRIPT_FILENAME']);
    $self = realpath(__FILE__);
    if ($script !== false && $self !== false && $script === $self) {
        http_response_code(404);
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        exit;
    }
}

function gap_require_private(string $frontDir): void
{
    try {
        $bootstrap = gap_private_bootstrap($frontDir);
    } catch (RuntimeException) {
        http_response_code(500);
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        header('Content-Type: text/plain; charset=utf-8');
        echo "Feedback is not available.\n";
        exit;
    }
    require $bootstrap;
}

function gap_private_bootstrap(string $frontDir): string
{
    $frontReal = realpath($frontDir);
    if ($frontReal === false) {
        throw new RuntimeException('Private application files are not available.');
    }
    $frontReal = gap_normalise_path($frontReal);
    $candidates = [];

    $env = getenv('GAP_FINDER_PRIVATE');
    if (is_string($env) && $env !== '') {
        $candidates[] = $env;
    }

    $hintFile = $frontReal . '/private-path.php';
    if (is_file($hintFile)) {
        $hint = require $hintFile;
        if (is_string($hint) && $hint !== '') {
            $candidates[] = $hint;
        }
    }

    // Local development: private/ is the sibling of public/.
    $candidates[] = dirname($frontReal) . '/private';
    // cPanel deploy: site files in $HOME/betterschools.com.au/gap-finder,
    // private files in $HOME/gap-finder-private.
    $candidates[] = dirname($frontReal, 2) . '/gap-finder-private';

    foreach ($candidates as $directory) {
        $bootstrap = rtrim(gap_normalise_path($directory), '/') . '/bootstrap.php';
        if (!is_file($bootstrap)) {
            continue;
        }
        $real = realpath($bootstrap);
        if ($real === false) {
            continue;
        }
        $real = gap_normalise_path($real);
        if (gap_path_is_web_exposed($real, $frontReal)) {
            continue;
        }
        return $real;
    }

    throw new RuntimeException('Private application files are not available.');
}

function gap_path_is_web_exposed(string $bootstrapReal, string $frontReal): bool
{
    $bootstrapReal = gap_normalise_path($bootstrapReal);
    $frontReal = rtrim(gap_normalise_path($frontReal), '/');
    $directory = rtrim(dirname($bootstrapReal), '/');
    if ($directory === $frontReal || str_starts_with($directory . '/', $frontReal . '/')) {
        return true;
    }
    if ($bootstrapReal === $frontReal || str_starts_with($bootstrapReal, $frontReal . '/')) {
        return true;
    }
    foreach (explode('/', $bootstrapReal) as $part) {
        if ($part === 'public_html' || $part === 'betterschools.com.au') {
            return true;
        }
    }
    return false;
}

function gap_normalise_path(string $path): string
{
    return str_replace('\\', '/', $path);
}
