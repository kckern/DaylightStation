# Install OS
ARG NODE_VERSION=20.11.0
FROM --platform=linux/amd64 node:${NODE_VERSION}-alpine

# Set work directory to /usr/src/app
WORKDIR /usr/src/app

# Install OpenSSH client, yt-dlp, and required dependencies
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

# Bundle app source
COPY . .

# install npm install moment-timezone --save
RUN npm install moment-timezone --save

# Install app dependencies and build
RUN npm install -g forever
RUN cd frontend && npm ci && npm run build
RUN cd backend && npm ci && chown -R node:node .

# Copy entrypoint script into the image
COPY entrypoint.sh /usr/src/app

# Make the entrypoint script executable
RUN chmod +x /usr/src/app/entrypoint.sh

# Ensure node user has access to necessary directories
RUN chown node:node /usr/src/app/known_hosts \
    && mkdir -p /home/node/.cache/yt-dlp \
    && chown -R node:node /home/node/.cache

USER node

# Test that yt-dlp works as the node user
RUN yt-dlp --version && echo "YouTube extraction verified during image build"

EXPOSE 3112
EXPOSE 3119

# Set the entrypoint script as the command to run when the container starts
ENTRYPOINT ["/usr/src/app/entrypoint.sh"]