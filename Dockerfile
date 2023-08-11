# Install OS
ARG NODE_VERSION=18.4.0
FROM --platform=linux/amd64 node:${NODE_VERSION}-alpine

# Set work directory to /usr/src/app
WORKDIR /usr/src/app

# Bundle app source
COPY . .

# Install app dependencies and build
RUN npm install -g forever && \
    cd frontend && npm ci && npm run build && \
    cd ../backend && npm ci && \
    chown -R node:node .

USER node

EXPOSE 3112

CMD forever backend/index.js