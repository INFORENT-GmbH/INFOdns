#!/usr/bin/env bash
# Render a max 2-minute HD gource visualization of the git history into
# web/public/gource.mp4 so the Vite build bundles it into the SPA.
#
# Builds a small debian image (gource + ffmpeg + xvfb) on first run and
# caches it as inforent-gource:local. gource needs an X display even when
# emitting a PPM stream, so it's wrapped in xvfb-run.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_REL="web/public/gource.mp4"
RESOLUTION="${GOURCE_RESOLUTION:-1920x1080}"
MAX_DURATION="${GOURCE_MAX_DURATION:-120}"
FRAMERATE="${GOURCE_FRAMERATE:-60}"
SECONDS_PER_DAY="${GOURCE_SECONDS_PER_DAY:-0.3}"
IMAGE="${GOURCE_IMAGE:-inforent-gource:local}"
TITLE="${GOURCE_TITLE:-INFORENT Prisma}"

mkdir -p "${REPO_DIR}/web/public"

docker build -t "${IMAGE}" -f "${REPO_DIR}/scripts/gource.Dockerfile" "${REPO_DIR}/scripts"

docker run --rm \
  -v "${REPO_DIR}:/repo" \
  -w /repo \
  "${IMAGE}" \
  "
    set -euo pipefail
    git config --global --add safe.directory /repo
    xvfb-run -a -s '-screen 0 ${RESOLUTION}x24' \
      gource \
        -${RESOLUTION} \
        --seconds-per-day ${SECONDS_PER_DAY} \
        --auto-skip-seconds 0.5 \
        --max-user-speed 500 \
        --hide mouse,progress \
        --bloom-multiplier 0.5 \
        --title '${TITLE}' \
        --background-colour 000000 \
        --output-framerate ${FRAMERATE} \
        --output-ppm-stream - \
    | ffmpeg -y -r ${FRAMERATE} -f image2pipe -vcodec ppm -i - \
        -t ${MAX_DURATION} \
        -vcodec libx264 -preset fast -pix_fmt yuv420p -crf 23 \
        -movflags +faststart \
        /repo/${OUTPUT_REL}
  "

echo "Generated: ${REPO_DIR}/${OUTPUT_REL}"
