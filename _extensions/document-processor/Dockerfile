FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    inotify-tools && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY src/ ./src/

CMD ["node", "src/watcher.mjs"]
