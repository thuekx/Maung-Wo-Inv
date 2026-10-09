import fs from 'fs';
import path from 'path';
import express, { ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { Prisma } from './orm';
import { config } from './config';
import { AppError } from './db';
import { core } from './routes/core';
import { woRoutes } from './routes/wo';
import { inventoryRoutes } from './routes/inventory';
import { procurementRoutes } from './routes/procurement';
import { radiusRoutes } from './routes/radius';
import { areaRoutes } from './routes/areas';
import { subscriptionRoutes } from './routes/subscriptions';
import { integrationRoutes } from './routes/integrations';
import { exportRoutes } from './routes/export';
import { adminRoutes } from './routes/admin';
import { masterRoutes } from './routes/masters';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.corsOrigin.split(','), credentials: false }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', index: false }));

const api = express.Router();
api.use(integrationRoutes); // tanpa JWT (pakai API key / secret)
api.use(exportRoutes); // tanpa JWT (pakai EXPORT_API_KEY)
api.use(core);
api.use(adminRoutes);
api.use(masterRoutes);
api.use(woRoutes);
api.use(inventoryRoutes);
api.use(procurementRoutes);
api.use(radiusRoutes);
api.use(areaRoutes);
api.use(subscriptionRoutes);
app.use('/api', api);

/** Pesan validasi Zod → Indonesia (tampil inline di bawah kolom). */
const idMsg = (m: string) =>
  m === 'Required' ? 'Wajib diisi'
  : m.replace(/^String must contain at least (\d+) character\(s\)$/, 'Minimal $1 karakter')
    .replace(/^String must contain at most (\d+) character\(s\)$/, 'Maksimal $1 karakter')
    .replace(/^Invalid email$/, 'Format email tidak valid')
    .replace(/^Expected number, received nan$/i, 'Harus berupa angka')
    .replace(/^Number must be greater than or equal to (.+)$/, 'Minimal $1')
    .replace(/^Number must be less than or equal to (.+)$/, 'Maksimal $1')
    .replace(/^Invalid enum value.*$/, 'Pilihan tidak valid');

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) return void res.status(err.status).json({ error: err.message, ...(err.fields ? { fields: err.fields } : {}) });
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of err.issues) { const k = i.path.join('.') || 'input'; if (!fields[k]) fields[k] = idMsg(i.message); }
    return void res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'input'}: ${idMsg(i.message)}`).join('; '), fields });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return void res.status(409).json({ error: 'Data duplikat (nilai unik sudah ada)' });
    if (err.code === 'P2025') return void res.status(404).json({ error: 'Data tidak ditemukan' });
  }
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan server' });
};
app.use(onError);

// Perbaiki foto demo lama yang berisi "&" tanpa escape (SVG tidak valid → galat XML di browser).
void (async () => {
  try {
    const dir = config.uploadDir;
    for (const f of (await fs.promises.readdir(dir)).filter((n) => /^demo-photo-.*\.svg$/.test(n))) {
      const fp = path.join(dir, f);
      const t = await fs.promises.readFile(fp, 'utf8');
      const fixed = t.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
      if (fixed !== t) await fs.promises.writeFile(fp, fixed);
    }
  } catch { /* folder belum ada: tidak masalah */ }
})();

app.listen(config.port, () => console.log(`MAUNG API :${config.port}`));
