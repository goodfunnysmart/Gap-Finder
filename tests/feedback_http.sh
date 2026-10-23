#!/bin/bash
# Requests that must not send mail: missing config, bad token, student payload, honeypot, cross-origin.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRIVATE="$(mktemp -d)"
cp "$ROOT/private/bootstrap.php" "$ROOT/private/feedback_lib.php" "$PRIVATE/"
PORT=8765
GAP_FINDER_PRIVATE="$PRIVATE" php -S 127.0.0.1:"$PORT" -t "$ROOT/public" >/tmp/gap-finder-php.log 2>&1 &
PID=$!
cleanup() { kill "$PID" >/dev/null 2>&1 || true; rm -rf "$PRIVATE"; }
trap cleanup EXIT
rm -f /tmp/gap-cookies
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -c /tmp/gap-cookies -b /tmp/gap-cookies "http://127.0.0.1:$PORT/feedback.php" >/tmp/gap-token.json 2>/dev/null; then
    break
  fi
  sleep 0.2
done
python3 - <<'PY'
import json
data=json.load(open("/tmp/gap-token.json"))
assert data["ok"] is True and len(data["csrf"])==64
open("/tmp/gap-csrf.txt","w").write(data["csrf"])
print("ok  HTTP GET token")
PY
TOKEN="$(cat /tmp/gap-csrf.txt)"
code() { curl -s -c /tmp/gap-cookies -b /tmp/gap-cookies -o /tmp/gap-body.json -w "%{http_code}" "$@"; }

STATUS="$(code -H 'Content-Type: application/json' -d '{"kind":"general","comment":"Hello there","company":""}' "http://127.0.0.1:$PORT/feedback.php")"
test "$STATUS" = "403"
echo "ok  HTTP POST without token"

STATUS="$(code -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" -H 'Sec-Fetch-Site: cross-site' -H 'Origin: https://evil.example' -d '{"kind":"general","comment":"Hello there","company":""}' "http://127.0.0.1:$PORT/feedback.php")"
test "$STATUS" = "403"
echo "ok  HTTP cross-origin"

STATUS="$(code -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" -H 'Sec-Fetch-Site: same-origin' -H 'Origin: http://127.0.0.1:'"$PORT" -d '{"kind":"general","comment":"Hello there","students":[{"name":"Sam"}],"company":""}' "http://127.0.0.1:$PORT/feedback.php")"
test "$STATUS" = "422"
python3 -c 'import json; body=json.load(open("/tmp/gap-body.json")); assert "Sam" not in json.dumps(body)'
echo "ok  HTTP student payload rejected"

STATUS="$(code -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" -H 'Sec-Fetch-Site: same-origin' -H 'Origin: http://127.0.0.1:'"$PORT" -d '{"kind":"general","comment":"Hello there","company":"https://spam.example"}' "http://127.0.0.1:$PORT/feedback.php")"
test "$STATUS" = "200"
echo "ok  HTTP honeypot"

STATUS="$(code -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" -H 'Sec-Fetch-Site: same-origin' -H 'Origin: http://127.0.0.1:'"$PORT" -d '{"kind":"general","comment":"Hello there","company":""}' "http://127.0.0.1:$PORT/feedback.php")"
test "$STATUS" = "503"
echo "ok  HTTP unconfigured feedback"
echo "feedback HTTP checks passed"
