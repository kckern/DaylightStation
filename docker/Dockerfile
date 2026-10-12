# syntax=docker/dockerfile:1.4
ARG NODE_VERSION=22.23.2
ARG CUTOVER_DEP_BASE=node:${NODE_VERSION}-alpine
FROM ${CUTOVER_DEP_BASE}
ARG CUTOVER_REUSE_DEPS=0
ARG CUTOVER_DEP_BASE

WORKDIR /usr/src/app

# Layer 1: System dependencies - stable, rarely changes
#
# ghostscript: the kitchen laser printer (Brother HL-L2460DW) is an
# AirPrint-class raster printer with NO PDF interpreter — it only accepts
# image/urf and image/pwg-raster (see LaserPrinterAdapter.mjs's header
# comment for the incident that proved this). `gs`'s `urf`/`pwgraster`
# devices are how PDFs get converted before they're sent. Verified (2026-08)
# that Alpine's ghostscript package (10.05.1-r0) ships both devices — do not
# remove this without re-checking that, since the printer will silently
# fail closed (LaserPrinterAdapter now refuses to send an unsupported
# format rather than guess) if `gs` disappears from the image.
RUN if [ "$CUTOVER_REUSE_DEPS" = "0" ]; then \
      apk add --no-cache openssh-client git curl ffmpeg tzdata yq android-tools su-exec fluidsynth soundfont-timgm exiftool ghostscript; \
    else \
      test "$CUTOVER_REUSE_DEPS" = "1" \
      && test "$CUTOVER_DEP_BASE" = "sha256:2217a991d3e1a8d4c8a973bc44ea2ebf7580330b8a19c7b0b57e64a6dd888929"; \
    fi

# Set System Timezone
ARG TZ=America/Los_Angeles
ENV TZ=${TZ}

# Layer 2: Build tools for native modules (canvas, etc.)
RUN if [ "$CUTOVER_REUSE_DEPS" = "0" ]; then apk add --no-cache cairo-dev jpeg-dev pango-dev giflib-dev g++ build-base; fi

# Layer 3: Python and yt-dlp - changes occasionally
RUN if [ "$CUTOVER_REUSE_DEPS" = "0" ]; then \
      apk add --no-cache python3 py3-pip \
      && pip3 install --no-cache-dir --break-system-packages "yt-dlp[default]@git+https://github.com/yt-dlp/yt-dlp.git" \
      && yt-dlp --version; \
    fi

# Layer 4: Global npm packages
RUN if [ "$CUTOVER_REUSE_DEPS" = "0" ]; then npm install -g forever; fi

# Layer 5: Copy package files for dependency caching
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/
# Root `npm ci` runs the developer-hook `prepare` script. The production
# context deliberately excludes `.git`, but the script itself must exist while
# dependencies install; it exits cleanly outside a checkout.
COPY scripts/install-git-hooks.mjs ./scripts/install-git-hooks.mjs
COPY scripts/setup-owner-dependencies.mjs ./scripts/setup-owner-dependencies.mjs

# Layer 6: Install all npm dependencies in one layer
#
# The stockfish package ships every build variant of the engine (~251MB);
# chess only needs the single-threaded lite build (~7MB). This image is
# single-stage, so the prune MUST be chained onto this SAME RUN as the
# install — a prune in a later RUN only writes whiteouts over an already
# committed layer and the 251MB stays in the image forever. The `test -f`
# guards fail the build (rather than silently ship chess on the fallback
# engine) if the lite-single files are missing. Note: the package's
# postinstall leaves `bin/stockfish.js`/`.wasm` as symlinks pointing at the
# full build; `find -type f` does not remove symlinks, so they end up
# dangling once the full build is deleted. That's fine as long as callers
# always request `'lite-single'` explicitly (never call `require('stockfish')()`
# with no argument), which is what the worker does.
RUN if [ "$CUTOVER_REUSE_DEPS" = "0" ]; then \
      npm ci --include=dev --legacy-peer-deps \
      && cd frontend && npm ci --legacy-peer-deps \
      && cd ../backend && npm ci --legacy-peer-deps \
      && SF=/usr/src/app/node_modules/stockfish/bin \
      && test -f "$SF/stockfish-18-lite-single.js" \
      && test -f "$SF/stockfish-18-lite-single.wasm" \
      && find "$SF" -type f ! -name 'stockfish-18-lite-single.*' -delete \
      && du -sh "$SF"; \
    else \
      for area in backend frontend; do \
        find "$area" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} \; ; \
      done \
      && rm -rf shared modules capabilities cli scripts \
      && rm -f package.json package-lock.json entrypoint.sh; \
    fi

# Layer 7: Copy application source (uses .dockerignore)
COPY --chown=node:node shared/ ./shared/
COPY --chown=node:node backend/ ./backend/
COPY --chown=node:node frontend/ ./frontend/
COPY --chown=node:node modules/ ./modules/
COPY --chown=node:node capabilities/ ./capabilities/
COPY --chown=node:node cli/ ./cli/
COPY --chown=node:node package*.json ./
COPY scripts/install-git-hooks.mjs ./scripts/install-git-hooks.mjs
COPY scripts/setup-owner-dependencies.mjs ./scripts/setup-owner-dependencies.mjs
RUN node scripts/setup-owner-dependencies.mjs && node scripts/setup-owner-dependencies.mjs --check

# Layer 8: Build frontend
#
# NODE_OPTIONS raises the V8 old-space cap for this step only. Node defaults to
# roughly 2 GB here, and the bundle crossed it during "rendering chunks": the
# build died with "FATAL ERROR: Reached heap limit Allocation failed" after
# transforming all ~12k modules, so every deploy failed at the last moment.
# The Docker VM has ~7.7 GB, so 4 GB leaves ample headroom for the rest of the
# build. If this is hit again the bundle needs splitting, not a bigger number.
RUN cd frontend && NODE_OPTIONS=--max-old-space-size=4096 npm run build

# The default context contains only a placeholder here. A cutover context may
# replace it with the independently pinned legacy hashed JS/CSS allowlist.
COPY docker/cutover-assets/ /tmp/cutover-assets/
RUN if [ "$CUTOVER_REUSE_DEPS" = "1" ]; then \
      test "$(find /tmp/cutover-assets -maxdepth 1 -type f ! -name .keep | wc -l)" -eq 388 \
      && test -z "$(find /tmp/cutover-assets -mindepth 1 -maxdepth 1 -type l -print -quit)" \
      && rm -f /tmp/cutover-assets/.keep \
      && mkdir -p /usr/src/app/frontend/dist/assets \
      && for file in /tmp/cutover-assets/*; do test ! -e "/usr/src/app/frontend/dist/assets/${file##*/}" || exit 1; done \
      && cp -a /tmp/cutover-assets/. /usr/src/app/frontend/dist/assets/; \
    fi \
    && rm -rf /tmp/cutover-assets

# Layer 9: Setup entrypoint and permissions
COPY docker/entrypoint.sh /usr/src/app/
RUN chmod +x /usr/src/app/entrypoint.sh \
    && touch /usr/src/app/known_hosts \
    && chown node:node /usr/src/app/known_hosts \
    && mkdir -p /home/node/.cache/yt-dlp \
    && chown -R node:node /home/node/.cache \
    && if [ "$CUTOVER_REUSE_DEPS" = "0" ]; then chown -R node:node /usr/src/app/backend; else test "$(stat -c %u:%g /usr/src/app/backend/node_modules)" = "1000:1000"; fi

# Layer 10: Build metadata (at END - changes every build)
ARG BUILD_TIME
ARG COMMIT_HASH
RUN echo "Build Time: ${BUILD_TIME:-unknown}" > /build.txt \
    && if [ -n "${COMMIT_HASH}" ]; then \
         echo "Commit: https://github.com/kckern/DaylightStation/commit/${COMMIT_HASH}" >> /build.txt; \
       else \
         echo "Commit: unknown" >> /build.txt; \
       fi

ENV NODE_ENV=production
EXPOSE 3111

# Liveness probe: an alive-but-unresponsive process (event-loop stall, swap
# thrash) stays "up" and is invisible to --restart unless-stopped, which only
# fires on process EXIT. This healthcheck marks the container unhealthy so an
# autoheal watcher can bounce it. curl is already installed (Layer 1).
HEALTHCHECK --interval=30s --timeout=8s --start-period=90s --retries=3 \
  CMD curl -fsS http://localhost:3111/ || exit 1

ENTRYPOINT ["/usr/src/app/entrypoint.sh"]
