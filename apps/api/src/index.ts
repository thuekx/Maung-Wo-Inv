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
import { integrationRoutes } from './routes/integrations';
import { exportRoutes } from './routes/export';

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
api.use(woRoutes);
api.use(inventoryRoutes);
app.use('/api', api);

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) return void res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) return void res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') });
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return void res.status(409).json({ error: 'Data duplikat (nilai unik sudah ada)' });
    if (err.code === 'P2025') return void res.status(404).json({ error: 'Data tidak ditemukan' });
  }
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan server' });
};
app.use(onError);

app.listen(config.port, () => console.log(`L1V WO API :${config.port}`));
