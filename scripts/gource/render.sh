#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-/repo/web/public/gource.mp4}"
WIDTH="${WIDTH:-1280}"
HEIGHT="${HEIGHT:-720}"
FPS="${FPS:-30}"
MAX_SECONDS="${MAX_SECONDS:-120}"
SECONDS_PER_DAY="${SECONDS_PER_DAY:-0.4}"

mkdir -p "$(dirname "$OUT")"

xvfb-run -a -s "-screen 0 ${WIDTH}x${HEIGHT}x24 +extension GLX +render -noreset" \
    gource /repo \
        --viewport "${WIDTH}x${HEIGHT}" \
        --seconds-per-day "$SECONDS_PER_DAY" \
        --auto-skip-seconds 0.1 \
        --max-files 0 \
        --hide mouse,progress \
        --bloom-multiplier 0.5 \
        --stop-at-end \
        --output-framerate "$FPS" \
        --output-ppm-stream - \
| ffmpeg -y \
        -r "$FPS" -f image2pipe -vcodec ppm -i - \
        -vcodec libx264 -preset medium -crf 23 -pix_fmt yuv420p \
        -movflags +faststart \
        -t "$MAX_SECONDS" \
        "$OUT"

echo "Rendered $OUT ($(du -h "$OUT" | cut -f1))"
