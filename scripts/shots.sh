#!/usr/bin/env bash
# Screenshot matrix: sizes x skipYears x zoom, via headless Chrome against the vite dev server.
# Usage: scripts/shots.sh [port]   (default 5199). Exits non-zero if any shot is missing or < 50 KB.
# A shot under 2 KB (Chrome sometimes writes a blank PNG under parallel load) is retried up to 2 times.
#
# The URL uses speed=0 (deviation from the original brief's speed=1, approved): the game starts
# paused so the HUD date is deterministic (1900-04-01 + skipYears*360 + 20 autoplay days) instead of
# drifting with however much virtual time Chrome lets the sim run.
# hour=16 steps the paused clock from noon to 16:00 (full daylight, lightLevel 1) so the diorama's sun
# shadows are long and visible: at noon they fall north, hidden behind the buildings.
# --headless=new counts browser chrome in --window-size: the page viewport is CHROME_H_OFFSET px
# shorter than the window. The window is made taller by that offset so the viewport equals the
# requested size, and the screenshot (which has an empty strip at the bottom) is cropped to w x h.
set -u
PORT="${1:-5199}"
CHROME_H_OFFSET="${CHROME_H_OFFSET:-87}"
JOBS="${JOBS:-4}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p shots
rm -f shots/*.png
VLOG=/tmp/shots-vite.log

node_modules/.bin/vite --port "$PORT" --strictPort >"$VLOG" 2>&1 &
VITE_PID=$!
trap 'kill $VITE_PID 2>/dev/null; wait $VITE_PID 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  curl -sf "http://localhost:$PORT/" >/dev/null && break
  sleep 0.5
done
curl -sf "http://localhost:$PORT/" >/dev/null || { echo "dev server did not start; see $VLOG" >&2; exit 1; }

shot() {
  local w="$1" h="$2" skip="$3" zoom="$4"
  local f="shots/${w}-y${skip}-z${zoom}.png"
  local udd attempt
  # under parallel Chromes a shot sometimes comes out blank (~301 bytes): retry those up to 2 times
  for attempt in 1 2 3; do
    udd="$(mktemp -d /tmp/shots-chrome.XXXXXX)"
    rm -f "$f"
    timeout 180 google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
      --user-data-dir="$udd" --virtual-time-budget=10000 \
      --window-size="$w,$((h + CHROME_H_OFFSET))" \
      --screenshot="$f" \
      "http://localhost:$PORT/?seed=7&autoplay=1&speed=0&skipYears=$skip&zoom=$zoom&hour=16" >/dev/null 2>&1
    rm -rf "$udd"
    if [ -f "$f" ] && [ "$(stat -c %s "$f")" -ge "$MIN_SHOT_BYTES" ]; then break; fi
    echo "blank or missing shot $f (attempt $attempt)" >&2
  done
  # crop the empty strip below the viewport
  convert "$f" -crop "${w}x${h}+0+0" +repage "$f" 2>/dev/null
}
export -f shot
MIN_SHOT_BYTES="${MIN_SHOT_BYTES:-2048}"
export PORT CHROME_H_OFFSET MIN_SHOT_BYTES

for size in 1366,768 1920,1080; do
  for skip in 0 25 55 85; do
    for zoom in 0.5 1 2; do
      echo "${size%,*} ${size#*,} $skip $zoom"
    done
  done
done | xargs -P "$JOBS" -L 1 bash -c 'shot "$@"' _

bad=0
for size in 1366 1920; do
  for skip in 0 25 55 85; do
    for zoom in 0.5 1 2; do
      f="shots/${size}-y${skip}-z${zoom}.png"
      if [ ! -f "$f" ] || [ "$(stat -c %s "$f")" -le 51200 ]; then echo "BAD: $f" >&2; bad=1; fi
    done
  done
done
echo "$(ls shots/*.png 2>/dev/null | wc -l) screenshots written"
[ "$bad" = 0 ] || { echo "some shots missing or too small; vite log: $VLOG" >&2; exit 1; }
