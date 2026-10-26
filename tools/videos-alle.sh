#!/usr/bin/env bash
# Nimmt die Anleitungsvideos (Eigner + Marina) in allen 6 Sprachen auf und legt sie ins Repo.
#   bash tools/videos-alle.sh            (braucht Node 22, Playwright, ffmpeg)
set -e
R=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d)
for L in de en sv no da fi; do
  PORT=8130; rm -rf "$T/data" "$T/$L"; mkdir -p "$T/$L"
  (cd "$R" && DATA_DIR="$T/data" PORT=$PORT node --disable-warning=ExperimentalWarning server/server.cjs > "$T/srv.log" 2>&1) & SP=$!; sleep 3
  (cd "$R" && LANG_VIDEO=$L BASE=http://localhost:$PORT node tools/videos.cjs "$T/$L" media)
  kill $SP; wait $SP 2>/dev/null || true
  for n in eigner marina; do
    ffmpeg -loglevel error -y -i "$(ls "$T/$L/raw-$n"/*.webm | head -1)" -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart -an "$R/anleitung-$n-$L.mp4"
    ffmpeg -loglevel error -y -ss 4 -i "$R/anleitung-$n-$L.mp4" -frames:v 1 -q:v 4 "$R/poster-$n-$L.jpg"
  done
  echo "$L fertig"
done
