<?php
declare(strict_types=1);

// Copy this file to config.php in the same private directory.
// On the server that directory is $HOME/gap-finder-private/, outside the website.
// Deploy never creates, copies, or deletes config.php.
//
// FEEDBACK_TO is where feedback email is delivered. The default is the public
// Better Schools address. Change it in the private config.php only.

return [
    'FEEDBACK_TO' => 'info@betterschools.com.au',
    'FEEDBACK_FROM' => 'noreply@betterschools.com.au',
];
