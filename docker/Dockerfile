# Install OS
ARG NODE_VERSION=20.11.0
FROM node:${NODE_VERSION}-alpine

# Set work directory to /usr/src/app
WORKDIR /usr/src/app

# Install OpenSSH client, yt-dlp, and required dependencies (cached until package versions change)
RUN apk add --no-cache openssh-client \
    && apk add --no-cache python3 py3-pip \
    && apk add --no-cache cairo-dev jpeg-dev pango-dev giflib-dev g++ build-base \
    && apk add --no-cache ffmpeg \
    && apk add --no-cache git curl \
    # Install yt-dlp with default dependencies (includes JS dependencies)
    && pip3 install --no-cache-dir --break-system-packages "yt-dlp[default]@git+https://github.com/yt-dlp/yt-dlp.git" \
    # Verify installations
    && echo "Node.js version: $(node --version)" \
    && echo "yt-dlp version: $(yt-dlp --version)" \
    # Test that yt-dlp can work with YouTube
    && yt-dlp --no-download --print title "dQw4w9WgXcQ"

# Install global npm packages (cached until package versions change)
RUN npm install -g forever

# Copy package files first for better caching
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/

# Install dependencies (cached until package*.json changes)
RUN npm install moment-timezone --save
RUN cd frontend && npm ci
RUN cd backend && npm ci && chown -R node:node .

# Bundle app source (only invalidates cache when code changes)
COPY --chown=node:node . .

# Build frontend (only runs when frontend code or deps change)
RUN cd frontend && npm run build

# Copy entrypoint script into the image
COPY docker/entrypoint.sh /usr/src/app

# Make the entrypoint script executable
RUN chmod +x /usr/src/app/entrypoint.sh

# Ensure node user has access to necessary directories
RUN chown node:node /usr/src/app/known_hosts \
    && mkdir -p /home/node/.cache/yt-dlp \
    && chown -R node:node /home/node/.cache

USER node

# Test that yt-dlp works as the node user
RUN yt-dlp --version && echo "YouTube extraction verified during image build"

# Set production environment
ENV NODE_ENV=production

EXPOSE 3112
EXPOSE 3119

# Set the entrypoint script as the command to run when the container starts
ENTRYPOINT ["/usr/src/app/entrypoint.sh"]