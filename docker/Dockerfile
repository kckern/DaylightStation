# syntax=docker/dockerfile:1.4
ARG NODE_VERSION=20.11.0
FROM node:${NODE_VERSION}-alpine

WORKDIR /usr/src/app

# Layer 1: System dependencies - stable, rarely changes
RUN apk add --no-cache openssh-client git curl ffmpeg tzdata yq

# Set System Timezone
ARG TZ=America/Los_Angeles
ENV TZ=${TZ}

# Layer 2: Build tools for native modules (canvas, etc.)
RUN apk add --no-cache cairo-dev jpeg-dev pango-dev giflib-dev g++ build-base

# Layer 3: Python and yt-dlp - changes occasionally
RUN apk add --no-cache python3 py3-pip \
    && pip3 install --no-cache-dir --break-system-packages "yt-dlp[default]@git+https://github.com/yt-dlp/yt-dlp.git" \
    && yt-dlp --version

# Layer 4: Global npm packages
RUN npm install -g forever

# Layer 5: Copy package files for dependency caching
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/

# Layer 6: Install all npm dependencies in one layer
RUN npm ci --include=dev \
    && cd frontend && npm ci \
    && cd ../backend && npm ci

# Layer 7: Copy application source (uses .dockerignore)
COPY --chown=node:node backend/ ./backend/
COPY --chown=node:node frontend/ ./frontend/
COPY --chown=node:node package*.json ./

# Layer 8: Build frontend
RUN cd frontend && npm run build

# Layer 9: Setup entrypoint and permissions
COPY docker/entrypoint.sh /usr/src/app/
RUN chmod +x /usr/src/app/entrypoint.sh \
    && touch /usr/src/app/known_hosts \
    && chown node:node /usr/src/app/known_hosts \
    && mkdir -p /home/node/.cache/yt-dlp \
    && chown -R node:node /home/node/.cache \
    && chown -R node:node /usr/src/app/backend

# Layer 10: Build metadata (at END - changes every build)
ARG BUILD_TIME
ARG COMMIT_HASH
RUN echo "Build Time: ${BUILD_TIME:-unknown}" > /build.txt \
    && echo "Commit: ${COMMIT_HASH:-unknown}" >> /build.txt

USER node
ENV NODE_ENV=production
EXPOSE 3111 3119
ENTRYPOINT ["/usr/src/app/entrypoint.sh"]