import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../db';
import { authenticate, requireRole } from '../auth';
import { applySsl, certStatus, dnsCheck, getSsl, sslAvailable, validDomain, buildCaddyfile } from '../ssl';

/** Admin → Pengaturan → SSL & Domain: status sertifikat Let's Encrypt, sakelar HTTPS & paksa-redirect. */
export const sslRoutes = Router();
sslRoutes.use('/admin/ssl', authenticate, requireRole('ADMIN'));

async function status() {
  const cfg = await getSsl();
  const available = sslAvailable();
  const cert = available && cfg.enabled && cfg.domain ? await certStatus(cfg.domain) : null;
  const dnsIps = cfg.domain ? await dnsCheck(cfg.domain) : [];
  const redirectActive = cfg.enabled && cfg.forceRedirect && !!cert?.ok;
  return { available, cfg, cert, dnsIps, redirectActive, preview: available ? buildCaddyfile(cfg, !!cert?.ok) : null };
}

sslRoutes.get('/admin/ssl', async (_req, res) => res.json(await status()));

sslRoutes.put('/admin/ssl', async (req, res) => {
  if (!sslAvailable()) throw new AppError(400, 'Mode HTTPS (Caddy) belum dipasang di server ini. Jalankan: bash scripts/deploy.sh --domain <domain-anda>');
  const b = z.object({
    enabled: z.boolean(),
    forceRedirect: z.boolean(),
    domain: z.string().trim().toLowerCase().max(253).default(''),
    email: z.string().trim().max(120).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Format email tidak valid').default(''),
  }).parse(req.body);
  if (b.enabled && !validDomain(b.domain)) throw new AppError(400, 'Isi nama domain yang valid (mis. wo.perusahaan.co.id) — Let\'s Encrypt tidak menerbitkan sertifikat untuk alamat IP');
  if (b.domain && !validDomain(b.domain)) throw new AppError(400, 'Nama domain tidak valid');
  await applySsl(b, req.user!.id);
  res.json(await status());
});
