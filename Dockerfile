FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --include=dev

FROM node:20-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules

COPY --chown=node:node . .

RUN mkdir -p /app/data /app/fonts && chown node:node /app/data /app/fonts

RUN rm -rf \
    .git \
    .gitignore \
    README.md \
    LICENSE \
    .env.example

USER node
EXPOSE 3000
CMD ["node", "server.js"]
