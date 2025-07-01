# Install OS
ARG NODE_VERSION=20.11.0
FROM --platform=linux/amd64 node:${NODE_VERSION}-alpine

# Set work directory to /usr/src/app
WORKDIR /usr/src/app

# Install OpenSSH client, yt-dlp, and required dependencies
RUN apk add --no-cache openssh-client \
    && apk add --no-cache python3 py3-pip \
    && apk add --no-cache cairo-dev jpeg-dev pango-dev giflib-dev g++ build-base \
    && pip3 install --no-cache-dir yt-dlp

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

RUN chown node:node /usr/src/app/known_hosts

USER node

EXPOSE 3112
EXPOSE 3119

# Set the entrypoint script as the command to run when the container starts
ENTRYPOINT ["/usr/src/app/entrypoint.sh"]