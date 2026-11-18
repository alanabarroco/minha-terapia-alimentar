FROM oven/bun:1
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY . .
ENV NODE_ENV=production DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["sh", "-c", "bun scripts/migrate.ts && bun src/server/index.ts"]
