FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gource \
        ffmpeg \
        xvfb \
        git \
        ca-certificates \
        mesa-utils \
        libgl1 && \
    rm -rf /var/lib/apt/lists/*

COPY render.sh /usr/local/bin/render.sh
RUN chmod +x /usr/local/bin/render.sh

WORKDIR /repo
ENTRYPOINT ["/usr/local/bin/render.sh"]
