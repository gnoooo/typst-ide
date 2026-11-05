FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git build-essential pkg-config \
        libwebkit2gtk-4.1-dev libsoup-3.0-dev libgtk-3-dev librsvg2-dev \
        webkit2gtk-driver xvfb ffmpeg xauth \
        fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Node pinned by the project (Vite 8 requires >= 20.19)
RUN curl -fsSL https://nodejs.org/dist/v20.20.2/node-v20.20.2-linux-x64.tar.xz \
    | tar -xJ -C /usr/local --strip-components=1

# Rust pinned by the project
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain 1.98.1 --profile minimal

RUN /root/.cargo/bin/cargo install tauri-driver

# Make the rustup toolchain reachable for non-root users (the repo is mounted
# and the build runs as the host user)
RUN chmod -R a+rX /root/.rustup /root/.cargo && chmod o+x /root

COPY run-in-container.sh /opt/demo/run-in-container.sh

ENV PATH="/root/.cargo/bin:/usr/local/bin:${PATH}"
