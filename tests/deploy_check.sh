#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="$(mktemp -d)"
export HOME="$HOME_DIR"
export SITE_ROOT="$HOME_DIR/betterschools.com.au"
# Preserve a Directory Privacy block and an existing private config.
mkdir -p "$SITE_ROOT/gap-finder" "$HOME_DIR/gap-finder-private"
cat > "$SITE_ROOT/gap-finder/.htaccess" <<'EOF'
# existing
# Section managed by cPanel: cp:ppd start
AuthUserFile "/home/example/.htpasswds/gap-finder/passwd"
AuthType Basic
Require valid-user
# End section managed by cPanel: cp:ppd
EOF
printf '%s\n' '<?php return ["FEEDBACK_TO"=>"kept@example.com","FEEDBACK_FROM"=>"noreply@betterschools.com.au"];' > "$HOME_DIR/gap-finder-private/config.php"
before="$(cat "$HOME_DIR/gap-finder-private/config.php")"
bash "$ROOT/deploy/cpanel-deploy.sh"
test -f "$SITE_ROOT/gap-finder/index.html"
test -f "$SITE_ROOT/gap-finder/feedback.php"
test -f "$SITE_ROOT/gap-finder/data/ma.json"
test -f "$SITE_ROOT/gap-finder/assets/logo-classic.webp"
test -f "$SITE_ROOT/gap-finder/private-path.php"
test -f "$HOME_DIR/gap-finder-private/bootstrap.php"
test -f "$HOME_DIR/gap-finder-private/config.example.php"
test -d "$HOME_DIR/gap-finder-private/throttle"
grep -q 'cp:ppd' "$SITE_ROOT/gap-finder/.htaccess"
grep -q 'AuthUserFile' "$SITE_ROOT/gap-finder/.htaccess"
grep -q 'Options -Indexes' "$SITE_ROOT/gap-finder/.htaccess"
after="$(cat "$HOME_DIR/gap-finder-private/config.php")"
test "$before" = "$after"
php -r '$p=require $argv[1]; exit($p===$argv[2]?0:1);' "$SITE_ROOT/gap-finder/private-path.php" "$HOME_DIR/gap-finder-private"
# The example on the server still has the public default, and the real config was not replaced.
grep -q 'info@betterschools.com.au' "$HOME_DIR/gap-finder-private/config.example.php"
grep -q 'kept@example.com' "$HOME_DIR/gap-finder-private/config.php"
# A second run still keeps the privacy block.
bash "$ROOT/deploy/cpanel-deploy.sh"
grep -q 'AuthUserFile' "$SITE_ROOT/gap-finder/.htaccess"
echo "deploy checks passed"
rm -rf "$HOME_DIR"
