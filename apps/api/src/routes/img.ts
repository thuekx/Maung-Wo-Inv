import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Router } from 'express';
import sharp from 'sharp';
import { config } from '../config';

/**
 * Gambar ditampilkan terkompresi: berkas asli di /uploads TIDAK diubah (tetap ukuran asli),
 * versi kecil (webp) dibuat saat diminta lalu disimpan di uploads/.cache.
 * GET /api/img?u=/uploads/xxx.png&w=240&trim=1   (w dibulatkan ke 80..2400; trim = buang tepi transparan/putih)
 */
export const imgRoutes = Router();

const root = path.resolve(config.uploadDir);
const cacheDir = path.join(root, '.cache');
const PASS = new Set(['.svg', '.gif']);

imgRoutes.get('/img', async (req, res) => {
  try {
    const u = String(req.query.u ?? '');
    if (!u.startsWith('/uploads/')) return res.status(400).json({ error: 'Parameter u tidak valid' });
    const src = path.resolve(root, decodeURIComponent(u.slice('/uploads/'.length)));
    if (!src.startsWith(root + path.sep) || src.startsWith(cacheDir) || !fs.existsSync(src)) return res.status(404).json({ error: 'Berkas tidak ditemukan' });
    const ext = path.extname(src).toLowerCase();
    if (PASS.has(ext)) return res.sendFile(src, { maxAge: '7d' });

    const w = Math.min(2400, Math.max(80, Math.round(Number(req.query.w) / 40) * 40 || 800));
    const trim = req.query.trim === '1';
    const st = fs.statSync(src);
    const key = crypto.createHash('sha1').update(`${src}|${st.mtimeMs}|${st.size}|${w}|${trim}`).digest('hex');
    const out = path.join(cacheDir, `${key}.webp`);
    if (!fs.existsSync(out)) {
      fs.mkdirSync(cacheDir, { recursive: true });
      let img = sharp(src, { failOn: 'none' }).rotate();
      if (trim) img = sharp(await img.toBuffer()).trim({ threshold: 12 });
      await img.resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toFile(out + '.tmp');
      fs.renameSync(out + '.tmp', out);
    }
    res.type('image/webp').sendFile(out, { dotfiles: 'allow', maxAge: '7d' });
  } catch {
    // gagal diproses → jangan putus tampilan: kembalikan berkas asli
    const u = String(req.query.u ?? '');
    const src = path.resolve(root, decodeURIComponent(u.replace('/uploads/', '')));
    if (src.startsWith(root + path.sep) && fs.existsSync(src)) return res.sendFile(src);
    res.status(404).json({ error: 'Berkas tidak ditemukan' });
  }
});
