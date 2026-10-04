FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
# Railway injects PORT; config.ts reads it. Migrations + merchant seed run on boot.
CMD ["bun", "run", "src/index.ts"]
