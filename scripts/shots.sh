#!/usr/bin/env bash
# Screenshot matrix: sizes x skipYears x zoom, via headless Chrome against the vite dev server.
set -u
PORT="${1:-5199}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p shots
rm -f shots/*.png

npx vite --port "$PORT" --strictPort >/tmp/shots-vite.log 2>&1 &
VITE_PID=$!
trap 'kill $VITE_PID 2>/dev/null; wait $VITE_PID 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  curl -sf "http://localhost:$PORT/" >/dev/null && break
  sleep 0.5
done
curl -sf "http://localhost:$PORT/" >/dev/null || { echo "dev server did not start" >&2; exit 1; }

for size in 1366,768 1920,1080; do
  w="${size%,*}"
  for skip in 0 25 55 85; do
    for zoom in 0.5 1 2; do
      out="shots/${w}-y${skip}-z${zoom}.png"
      udd="$(mktemp -d /tmp/shots-chrome.XXXXXX)"
      timeout 180 google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
        --user-data-dir="$udd" --virtual-time-budget=60000 --window-size="$size" \
        --screenshot="$out" \
        "http://localhost:$PORT/?seed=7&autoplay=1&speed=1&skipYears=$skip&zoom=$zoom" >/dev/null 2>&1
      rm -rf "$udd"
    done
  done
done

echo "$(ls shots/*.png 2>/dev/null | wc -l) screenshots written"
