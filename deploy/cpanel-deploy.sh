#!/bin/bash
# Copy this repository into the cPanel account that serves the site.
# Document root: $SITE_ROOT, default $HOME/betterschools.com.au. Export SITE_ROOT to override.
# Site files go to $SITE_ROOT/gap-finder.
# Private application files go to $HOME/gap-finder-private.
# config.php is never created, copied, or deleted.
# The site .htaccess keeps its cPanel Directory Privacy block.
set -euo pipefail

SITE_ROOT="${SITE_ROOT:-${HOME:-}/betterschools.com.au}"

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

CP=/bin/cp
MKDIR=/bin/mkdir
CHMOD=/bin/chmod
MV=/bin/mv
RM=/bin/rm
GREP=/bin/grep

if [[ -x /usr/bin/awk ]]; then
  AWK=/usr/bin/awk
elif [[ -x /bin/awk ]]; then
  AWK=/bin/awk
else
  printf '%s\n' "awk is required to preserve Directory Privacy rules." >&2
  exit 1
fi

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

resolve_path() {
  if [[ -x /usr/bin/realpath ]]; then
    /usr/bin/realpath -- "$1"
  elif [[ -x /bin/realpath ]]; then
    /bin/realpath -- "$1"
  else
    readlink -f -- "$1"
  fi
}

tmp_files=()
cleanup() {
  local f
  if [[ ${#tmp_files[@]} -eq 0 ]]; then
    return 0
  fi
  for f in "${tmp_files[@]}"; do
    if [[ -n "$f" && -f "$f" ]]; then
      "$RM" -f "$f"
    fi
  done
}
trap cleanup EXIT

if [[ -n "${CPANEL_DEPLOY_REPO:-}" ]]; then
  REPO="$(cd "$CPANEL_DEPLOY_REPO" && pwd)"
else
  REPO="$(cd "$(dirname "$0")/.." && pwd)"
fi
cd "$REPO"

case "$REPO" in
  */public_html|*/public_html/*)
    die "Refusing to deploy: the Git clone is inside public_html. Clone to \$HOME/repositories/Gap-Finder."
    ;;
  */betterschools.com.au|*/betterschools.com.au/*)
    die "Refusing to deploy: the Git clone is inside the document root. Clone to \$HOME/repositories/Gap-Finder."
    ;;
esac

if [[ -z "${HOME:-}" || "$HOME" == "/" ]]; then
  die "Refusing to deploy: HOME is unset or '/'."
fi
case "$HOME" in
  *[[:space:]]*|*\'*|*\"*|*'\'*)
    die "Refusing to deploy: HOME contains unsafe characters."
    ;;
esac
if [[ ! "$HOME" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  die "Refusing to deploy: HOME is not a plain absolute path."
fi

SITE_ROOT="${SITE_ROOT%/}"
if [[ -z "$SITE_ROOT" || "$SITE_ROOT" == "/" ]]; then
  die "Refusing to deploy: SITE_ROOT is empty or '/'."
fi
case "$SITE_ROOT" in
  *[[:space:]]*|*\'*|*\"*|*'\'*)
    die "Refusing to deploy: SITE_ROOT contains unsafe characters."
    ;;
esac
if [[ ! "$SITE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  die "Refusing to deploy: SITE_ROOT is not a plain absolute path."
fi
case "$SITE_ROOT" in
  "$HOME"/*) ;;
  *) die "Refusing to deploy: SITE_ROOT must be a directory inside HOME." ;;
esac
case "/$SITE_ROOT/" in
  */../*|*/./*)
    die "Refusing to deploy: SITE_ROOT contains '.' or '..'."
    ;;
  */public_html|*/public_html/*)
    die "Refusing to deploy: SITE_ROOT is inside public_html. Use \$HOME/betterschools.com.au."
    ;;
esac

PUBLIC="$SITE_ROOT/gap-finder"
PRIVATE="$HOME/gap-finder-private"

if [[ -L "$SITE_ROOT" || -L "$PUBLIC" || -L "$PRIVATE" ]]; then
  die "Refusing to deploy through a symlink."
fi

[[ -f "$REPO/public/index.html" ]] || die "Missing public/index.html. Run python3 source/build.py first."
[[ -f "$REPO/public/feedback.php" ]] || die "Missing public/feedback.php."
[[ -f "$REPO/public/private_path.php" ]] || die "Missing public/private_path.php."
[[ -f "$REPO/public/app.js" ]] || die "Missing public/app.js."
[[ -f "$REPO/public/.htaccess" ]] || die "Missing public/.htaccess."
[[ -f "$REPO/public/data/ma.json" ]] || die "Missing public/data/ma.json."
[[ -f "$REPO/public/data/en.json" ]] || die "Missing public/data/en.json."
[[ -f "$REPO/private/bootstrap.php" ]] || die "Missing private/bootstrap.php."
[[ -f "$REPO/private/feedback_lib.php" ]] || die "Missing private/feedback_lib.php."
[[ -f "$REPO/private/config.example.php" ]] || die "Missing private/config.example.php."

if "$GREP" -q 'cp:ppd' "$REPO/public/.htaccess"; then
  die "Refusing to deploy: public/.htaccess contains a cPanel Directory Privacy marker."
fi

"$MKDIR" -p -- "$PUBLIC" "$PRIVATE"

if [[ -L "$SITE_ROOT" || -L "$PUBLIC" || -L "$PRIVATE" ]]; then
  die "Refusing to deploy through a symlink."
fi

home_real="$(resolve_path "$HOME")"
site_real="$(resolve_path "$SITE_ROOT")"
public_real="$(resolve_path "$PUBLIC")"
private_real="$(resolve_path "$PRIVATE")"
repo_real="$(resolve_path "$REPO")"
[[ "$site_real" == "$home_real"/* ]] || die "Refusing to deploy: SITE_ROOT is outside HOME."
[[ "$public_real" == "$site_real/gap-finder" ]] || die "Public path is not \$SITE_ROOT/gap-finder."
[[ "$private_real" == "$home_real/gap-finder-private" ]] || die "Private path is not \$HOME/gap-finder-private."
case "$site_real" in
  "$home_real"/public_html|"$home_real"/public_html/*)
    die "Refusing to place site files inside public_html."
    ;;
esac
case "$private_real" in
  "$home_real"/public_html|"$home_real"/public_html/*)
    die "Refusing to place private files inside public_html."
    ;;
  "$site_real"|"$site_real"/*)
    die "Refusing to place private files inside the document root."
    ;;
esac
case "$repo_real" in
  "$site_real"|"$site_real"/*)
    die "Refusing to deploy: the Git clone is inside the document root. Clone to \$HOME/repositories/Gap-Finder."
    ;;
  "$home_real"/public_html|"$home_real"/public_html/*)
    die "Refusing to deploy: the Git clone is inside public_html. Clone to \$HOME/repositories/Gap-Finder."
    ;;
esac

htaccess_tmp="$PRIVATE/.htaccess.deploy.$$"
tmp_files+=("$htaccess_tmp")
"$CP" "$REPO/public/.htaccess" "$htaccess_tmp"

dest_htaccess="$PUBLIC/.htaccess"
if [[ -f "$dest_htaccess" ]] && "$GREP" -q 'cp:ppd' "$dest_htaccess"; then
  block="$("$AWK" '
    /cp:ppd/ {
      if (!started) start = NR
      end = NR
      started = 1
    }
    { lines[NR] = $0 }
    END {
      if (started) {
        for (i = start; i <= end; i++) print lines[i]
      }
    }
  ' "$dest_htaccess")"
  if ! printf '%s\n' "$block" | "$GREP" -q 'AuthUserFile' \
    || ! printf '%s\n' "$block" | "$GREP" -q 'Require' \
    || ! printf '%s\n' "$block" | "$GREP" -q 'End section managed by cPanel'; then
    die "Refusing to replace .htaccess: the Directory Privacy block is incomplete."
  fi
  {
    printf '\n'
    printf '%s\n' "$block"
  } >> "$htaccess_tmp"
elif [[ -f "$dest_htaccess" ]] && "$GREP" -E -q 'AuthUserFile|AuthType[[:space:]]+Basic|Require[[:space:]]+valid-user' "$dest_htaccess"; then
  die "Refusing to replace .htaccess: authentication directives were found outside a cPanel cp:ppd block."
fi

copy_file() {
  local src="$1" dest="$2" mode="$3"
  local name
  name="$(basename "$src")"
  [[ -L "$src" ]] && die "Refusing to deploy symlink $name."
  [[ -f "$src" ]] || die "Refusing to deploy non-file $name."
  if [[ -L "$dest" ]]; then
    "$RM" -- "$dest"
  fi
  "$CP" -- "$src" "$dest"
  "$CHMOD" "$mode" -- "$dest"
}

copy_tree() {
  local src="$1" dest="$2"
  local asset asset_name
  if [[ -L "$dest" ]]; then
    die "Refusing to deploy through a symlink."
  fi
  "$MKDIR" -p -- "$dest"
  for asset in "$src"/*; do
    asset_name="$(basename "$asset")"
    [[ -f "$asset" ]] || die "Refusing to deploy non-file $asset_name."
    case "$asset_name" in
      *.webp|*.png|*.svg|*.json|*.woff2|*.txt) ;;
      *) die "Refusing to deploy unexpected file $asset_name." ;;
    esac
    copy_file "$asset" "$dest/$asset_name" 644
  done
}

shopt -s nullglob
for path in "$REPO"/public/*; do
  name="$(basename "$path")"
  case "$name" in
    private-path.php|config.php|config.*.php)
      die "Refusing to publish $name."
      ;;
  esac
  if [[ -d "$path" ]]; then
    case "$name" in
      assets|data|fonts) copy_tree "$path" "$PUBLIC/$name" ;;
      *) die "Refusing to deploy unexpected directory $name." ;;
    esac
    continue
  fi
  copy_file "$path" "$PUBLIC/$name" 644
done

for path in "$REPO"/private/*; do
  name="$(basename "$path")"
  if [[ -d "$path" ]]; then
    [[ "$name" == "throttle" ]] && continue
    die "Refusing to deploy unexpected private directory $name."
  fi
  case "$name" in
    config.example.php|bootstrap.php|feedback_lib.php) ;;
    config.php|config.*.php) continue ;;
    *) die "Refusing to deploy unexpected private file $name." ;;
  esac
  copy_file "$path" "$PRIVATE/$name" 600
done

"$MKDIR" -p -- "$PRIVATE/throttle"
"$CHMOD" 700 -- "$PRIVATE/throttle"

[[ -f "$PUBLIC/index.html" && -f "$PUBLIC/feedback.php" && -f "$PUBLIC/private_path.php" ]] || die "Site files were not deployed."
[[ -f "$PUBLIC/assets/logo-classic.webp" && -f "$PUBLIC/assets/logo-dark.webp" ]] || die "Logo files were not deployed."
[[ -f "$PUBLIC/data/ma.json" && -f "$PUBLIC/data/en.json" ]] || die "Subject data was not deployed."
[[ -f "$PRIVATE/bootstrap.php" && -f "$PRIVATE/feedback_lib.php" && -f "$PRIVATE/config.example.php" ]] || die "Private files were not deployed."
[[ ! -e "$REPO/private/config.php" || ! -e "$PRIVATE/config.php" || "$(resolve_path "$REPO/private/config.php")" != "$(resolve_path "$PRIVATE/config.php")" ]] || die "Refusing to treat the repository config.php as the server file."

if [[ -f "$PRIVATE/config.php" && ! -L "$PRIVATE/config.php" ]]; then
  "$CHMOD" 600 -- "$PRIVATE/config.php"
fi
"$CHMOD" 700 -- "$PRIVATE"
"$CHMOD" 755 -- "$PUBLIC"

case "$PRIVATE" in
  *\'*)
    die "Refusing to write private-path.php: the private path contains a quote."
    ;;
esac

hint_tmp="$PRIVATE/.private-path.php.$$"
tmp_files+=("$hint_tmp")
cat > "$hint_tmp" <<EOF
<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' && isset(\$_SERVER['SCRIPT_FILENAME']) && realpath((string) \$_SERVER['SCRIPT_FILENAME']) === realpath(__FILE__)) {
    http_response_code(404);
    header('Cache-Control: no-store');
    exit;
}
return '${PRIVATE}';
EOF
"$CHMOD" 644 -- "$hint_tmp"
"$MV" -- "$hint_tmp" "$PUBLIC/private-path.php"
"$CHMOD" 644 -- "$PUBLIC/private-path.php"

"$CHMOD" 644 -- "$htaccess_tmp"
"$MV" -- "$htaccess_tmp" "$dest_htaccess"
"$CHMOD" 644 -- "$dest_htaccess"

for leftover in private public source README.md tests .git; do
  if [[ -e "$PUBLIC/$leftover" ]]; then
    printf 'WARNING: %s is still inside the web directory. Deploy did not remove it.\n' "$PUBLIC/$leftover"
  fi
done

printf 'Deployed site files to %s\n' "$PUBLIC"
printf 'Deployed private files to %s\n' "$PRIVATE"
if [[ -f "$PRIVATE/config.php" ]]; then
  printf 'Left existing config.php in place.\n'
else
  printf 'config.php is not in the private directory. Copy config.example.php to config.php there. FEEDBACK_TO defaults to the public address in the example.\n'
fi
