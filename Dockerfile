# Install OS
ARG NODE_VERSION=18.4.0
FROM --platform=linux/amd64 node:${NODE_VERSION}-alpine
RUN npm install -g forever

# Install app
WORKDIR /usr/src/app
COPY . .
EXPOSE 3112

# Frontend
RUN cd frontend && npm i
RUN cd frontend && npm run build 

# Backend
RUN cd backend && npm i
USER node
CMD forever backend/index.js