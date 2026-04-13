FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server

RUN mkdir -p /app/server/data /app/server/photos /app/server/avatars /app/server/parsed

EXPOSE 3001

CMD ["node", "server/server.js"]
