# Studio 64 in a container: Node, Python, the build tools, the Emscripten SDK and Chromium (for the
# object pictures) are inside, so the first-run setup needs nothing from your computer.
#   docker compose up      then open http://localhost:8064 and drop your ROM
# Your ROM is not part of the image: you drop it into the browser, like without Docker.
FROM node:22-bookworm

ARG EMSDK_VERSION=6.0.12
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 python3-venv python3-pip git ca-certificates xz-utils chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

# the compiler, with SDL2 prebuilt (the cache stays writable for any user)
ENV EMSDK=/opt/emsdk
RUN git clone --depth 1 https://github.com/emscripten-core/emsdk.git $EMSDK \
 && cd $EMSDK && ./emsdk install $EMSDK_VERSION && ./emsdk activate $EMSDK_VERSION \
 && bash -c 'source ./emsdk_env.sh && embuilder build sdl2' \
 && chmod -R a+rwX $EMSDK/upstream/emscripten/cache

ENV CHROME=/usr/bin/chromium STUDIO_OPEN=0 STUDIO_IN_DOCKER=1 HOST=0.0.0.0 PORT=8064
WORKDIR /studio64
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
EXPOSE 8064
CMD ["node", "tools/start.mjs"]
