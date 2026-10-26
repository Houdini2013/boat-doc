#!/usr/bin/env bash
# Holt den neuesten Stand von GitHub und rollt ihn aus, wenn sich etwas geändert hat.
# Läuft alle 2 Minuten (boatsdoc-update.timer). Von Hand: boatsdoc-update --force
set -euo pipefail
REPO=/srv/boatsdoc/repo
APP=/srv/boatsdoc/app
STAND=/srv/boatsdoc/ausgerollt
# nur die benötigten Werte lesen (die Datei enthält Passwörter mit beliebigen Zeichen, daher nicht "sourcen")
wert() { grep -E "^$1=" /etc/boatsdoc.env | tail -1 | cut -d= -f2- | sed -E "s/^'(.*)'$/\1/"; }
BRANCH=$(wert BRANCH); BASE_URL=$(wert BASE_URL)
BRANCH="${BRANCH:-main}"
cd "$REPO"

# Testzweig schon in main übernommen oder gelöscht → ab jetzt main verfolgen
if [ "$BRANCH" != "main" ]; then
  ZWEIG=$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)
  git fetch -q --depth 50 origin main
  MAIN=$(git rev-parse FETCH_HEAD)
  [ -z "$ZWEIG" ] || git fetch -q --depth 50 origin "$BRANCH"
  if [ -z "$ZWEIG" ] || git merge-base --is-ancestor "$ZWEIG" "$MAIN" 2>/dev/null; then
    sed -i 's/^BRANCH=.*/BRANCH=main/' /etc/boatsdoc.env
    BRANCH=main
    echo "Wechsle auf main"
  fi
fi

git fetch -q --depth 1 origin "$BRANCH"
NEU=$(git rev-parse FETCH_HEAD)
ALT=$(cat "$STAND" 2>/dev/null || true)
if [ "$NEU" = "$ALT" ] && [ "${1:-}" != "--force" ]; then exit 0; fi

git checkout -q -B "$BRANCH" FETCH_HEAD
rsync -a --delete --exclude .git --exclude .github --exclude data ./ "$APP/"
chown -R boatsdoc:boatsdoc "$APP"
# Hilfsskripte und Dienste mitziehen (wirken ab dem nächsten Lauf)
install -m 755 deploy/update.sh /usr/local/bin/boatsdoc-update
install -m 755 deploy/backup.sh /usr/local/bin/boatsdoc-backup
for u in boatsdoc.service boatsdoc-backup.service boatsdoc-backup.timer boatsdoc-update.service boatsdoc-update.timer; do
  cmp -s "deploy/$u" "/etc/systemd/system/$u" || { install -m 644 "deploy/$u" "/etc/systemd/system/$u"; NEU_LADEN=1; }
done
[ -n "${NEU_LADEN:-}" ] && systemctl daemon-reload
systemctl restart boatsdoc

# Caddy-Konfiguration mitziehen, wenn sie sich im Repo geändert hat
DOMAIN=$(echo "${BASE_URL:-https://boatsdoc.com}" | sed -E 's#^https?://##; s#/.*$##; s#^www\.##')
sed "s/{{DOMAIN}}/$DOMAIN/g" deploy/Caddyfile > /tmp/Caddyfile.neu
if ! cmp -s /tmp/Caddyfile.neu /etc/caddy/Caddyfile; then
  if caddy validate --adapter caddyfile --config /tmp/Caddyfile.neu >/dev/null 2>&1; then
    cp /tmp/Caddyfile.neu /etc/caddy/Caddyfile && systemctl reload caddy && echo "Caddy neu geladen"
  else
    echo "WARNUNG: neue Caddy-Konfiguration ungültig, alte bleibt aktiv" >&2
  fi
fi
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8080/api/ping >/dev/null 2>&1; then
    echo "$NEU" > "$STAND"
    echo "Ausgerollt: $BRANCH $NEU"
    exit 0
  fi
  sleep 1
done
echo "FEHLER: Dienst antwortet nach Ausrollen von $NEU nicht" >&2
exit 1
