# Render worker of the remote server: manim, LaTeX, Chromium, pandoc and the voice. Run without network and secrets, see
# rag/compose.yml. System packages rather than TinyTeX and Puppeteer's Chromium, which do not exist for every architecture.
FROM node:22-bookworm-slim
ENV PUPPETEER_SKIP_DOWNLOAD=1 PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium HOME=/tmp PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git ffmpeg pandoc chromium xvfb xauth libgl1 libegl1 libgl1-mesa-dri \
    python3 python3-venv python3-dev build-essential pkg-config libcairo2-dev libpango1.0-dev \
    texlive-latex-base texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended texlive-fonts-extra \
    texlive-science tipa cm-super dvisvgm fonts-dejavu fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Heavy installs first, then the code: a change in src/ or modules/ must not rebuild (and re-pull) the layers below, which
# only depend on their own manifests and pinned versions.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY modules/documents/package.json modules/documents/package-lock.json ./modules/documents/
RUN cd modules/documents && npm ci --no-audit --no-fund
# Same versions as src/setup/modules/visuals.ts and src/setup/modules/voice.ts.
RUN git -c advice.detachedHead=false clone --quiet --depth 1 --branch v1.7.2 https://github.com/3b1b/manim.git vendor/manim \
  && python3 -m venv vendor/manim/.venv \
  && vendor/manim/.venv/bin/pip install --quiet --upgrade pip "setuptools<81" \
  && vendor/manim/.venv/bin/pip install --quiet -e vendor/manim
RUN python3 -m venv vendor/kokoro/.venv \
  && vendor/kokoro/.venv/bin/pip install --quiet --retries 6 kokoro-onnx==0.6.1 \
  && curl -fsSL --retry 6 --retry-all-errors --retry-delay 10 -o vendor/kokoro/kokoro-v1.0.int8.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx \
  && curl -fsSL --retry 6 --retry-all-errors --retry-delay 10 -o vendor/kokoro/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
COPY tsconfig.json ./
COPY src ./src
COPY modules ./modules
RUN mkdir -p /jobs /voice-cache && chown node:node /jobs /voice-cache
USER node
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/server/worker.ts"]
