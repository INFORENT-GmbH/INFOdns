FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends gource ffmpeg xvfb xauth ca-certificates git \
 && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/bin/bash", "-c"]
