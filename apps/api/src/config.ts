import 'dotenv/config';

const env = process.env;

export const config = {
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT ?? 4000),
  jwtSecret: env.JWT_SECRET ?? 'dev-secret-change-me',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
  webUrl: env.WEB_URL ?? 'http://localhost:3000',
  corsOrigin: env.CORS_ORIGIN ?? env.WEB_URL ?? 'http://localhost:3000',
  uploadDir: env.UPLOAD_DIR ?? './uploads',
  smtp: {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT ?? 587),
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM ?? 'L1V WO <noreply@l1v.local>',
  },
  telegram: {
    token: env.TELEGRAM_BOT_TOKEN,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? 'change-me',
    // chat/grup per divisi, contoh: {"NOC":"-1001234","FOC":"-1005678"}
    roleChats: JSON.parse(env.TELEGRAM_ROLE_CHATS ?? '{}') as Record<string, string>,
  },
  billing: {
    apiKey: env.BILLING_API_KEY ?? 'dev-billing-key', // dipakai billing saat memanggil WO App
    webhookUrl: env.BILLING_WEBHOOK_URL, // tujuan event keluar dari WO App
    webhookSecret: env.BILLING_WEBHOOK_SECRET ?? 'dev-webhook-secret',
  },
};

if (config.isProd && config.jwtSecret === 'dev-secret-change-me') {
  throw new Error('JWT_SECRET wajib diisi di production');
}
