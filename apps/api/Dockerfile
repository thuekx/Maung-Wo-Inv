FROM node:24-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# prisma generate tidak butuh DB, tetapi config membaca DATABASE_URL
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run build

FROM node:24-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# prisma (CLI untuk migrate deploy) ada di dependencies, jadi cukup --omit=dev
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN mkdir -p uploads backups
EXPOSE 4000
# Command diatur di docker-compose.yml: migrate → "prisma migrate deploy", api → index.js, worker → worker.js
CMD ["node", "dist/src/index.js"]
