FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev && npm i prisma@^6 --no-save
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
RUN mkdir -p uploads
EXPOSE 4000
# api: sinkron skema lalu start (ganti ke "migrate deploy" setelah migrasi dibuat dengan npm run db:migrate) | worker: override command → node dist/src/worker.js
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/src/index.js"]
