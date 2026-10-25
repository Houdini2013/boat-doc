#!/usr/bin/env bash
# Nächtliches Backup: konsistente Kopie der Datenbank + Uploads, 14 Tage aufbewahrt.
# Für ein Backup außer Haus /srv/boatsdoc/backup zusätzlich z. B. in IONOS S3 Object Storage kopieren.
set -euo pipefail
DATA=/srv/boatsdoc/data
ZIEL=/srv/boatsdoc/backup
TAG=$(date +%Y-%m-%d)
mkdir -p "$ZIEL/$TAG"
node --disable-warning=ExperimentalWarning -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1]);
  db.exec(`VACUUM INTO '"'"'${process.argv[2]}'"'"'`);
' "$DATA/boatsdoc.db" "$ZIEL/$TAG/boatsdoc.db"
# Uploads: unveränderte Dateien als harte Links zum Vortag (spart Platz)
VORTAG=$(ls -1d "$ZIEL"/20* 2>/dev/null | grep -v "$TAG" | tail -1 || true)
if [ -n "$VORTAG" ] && [ -d "$VORTAG/uploads" ]; then
  rsync -a --link-dest="$VORTAG/uploads" "$DATA/uploads/" "$ZIEL/$TAG/uploads/"
else
  rsync -a "$DATA/uploads/" "$ZIEL/$TAG/uploads/"
fi
find "$ZIEL" -maxdepth 1 -type d -name '20*' -mtime +14 -exec rm -rf {} +
echo "Backup $TAG fertig"
