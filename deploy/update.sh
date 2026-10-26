#!/usr/bin/env bash
# Holt den neuesten Stand von GitHub und rollt ihn aus, wenn sich etwas geändert hat.
# Läuft alle 2 Minuten (boatsdoc-update.timer). Von Hand: boatsdoc-update --force
set -euo pipefail
REPO=/srv/boatsdoc/repo
APP=/srv/boatsdoc/app
STAND=/srv/boatsdoc/ausgerollt
set -a; . /etc/boatsdoc.env; set +a
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
systemctl restart boatsdoc
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
