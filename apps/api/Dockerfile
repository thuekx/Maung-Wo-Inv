FROM node:24-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# prisma generate tidak butuh DB, tetapi config membaca DATABASE_URL
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run build

FROM node:24-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev && npm i prisma@^7.10 --no-save
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN mkdir -p uploads
EXPOSE 4000
# api: sinkron skema lalu start (ganti ke "prisma migrate deploy" setelah migrasi dibuat dengan npm run db:migrate)
# worker: override command → node dist/src/worker.js
CMD ["sh", "-c", "npx prisma db push && node dist/src/index.js"]
