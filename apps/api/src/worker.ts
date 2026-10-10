import crypto from 'crypto';
import fs from 'fs';
import { Worker, Job } from 'bullmq';
import { config } from './config';
import { prisma } from './db';
import { connection, cronQueue, enqueue, QueuedJob } from './queue';
import { sendEmail, sendTelegram, sendWhatsApp } from './senders';
import { Effects } from './effects';
import { getRadius, runSync } from './radius';
import { putSetting, getSetting, startWebUrlSync } from './settings';

startWebUrlSync(); // URL aplikasi dari Admin untuk tautan di notifikasi

/** Kirim email / Telegram dari tabel Notification (outbox). */
new Worker(
  'notifications',
  async (job: Job<{ id: string }>) => {
    const n = await prisma.notification.findUnique({ where: { id: job.data.id } });
    if (!n || n.status === 'SENT') return;
    try {
      const text = `${n.subject}\n\n${n.body}`;
      const r = n.channel === 'EMAIL' ? await sendEmail(n.target, n.subject, n.body) : n.channel === 'WHATSAPP' ? await sendWhatsApp(n.target, `${n.subject}\n\n${n.body}`, undefined, false, { subject: n.subject, body: n.body }) : await sendTelegram(n.target, text);
      if (r === 'disabled') {
        const why = n.channel === 'WHATSAPP' ? 'Pengiriman WhatsApp dinonaktifkan (Admin → Pengaturan → WhatsApp → sakelar)' : 'Pengiriman email dinonaktifkan (Admin → Pengaturan → SMTP → sakelar Email aktif)';
        await prisma.notification.update({ where: { id: n.id }, data: { status: 'NOT_SENT', error: why } });
        return;
      }
      if (r === 'dry-run') {
        const why = n.channel === 'EMAIL' ? 'SMTP belum dikonfigurasi (Admin → Integrasi)' : n.channel === 'WHATSAPP' ? 'Gateway WhatsApp belum dikonfigurasi (Admin → Pengaturan → WhatsApp)' : 'Token bot Telegram belum dikonfigurasi (Admin → Integrasi)';
        await prisma.notification.update({ where: { id: n.id }, data: { status: 'NOT_SENT', error: why } });
        return;
      }
      await prisma.notification.update({ where: { id: n.id }, data: { status: 'SENT', sentAt: new Date(), error: null } });
    } catch (e) {
      await prisma.notification.update({ where: { id: n.id }, data: { status: 'FAILED', error: String(e).slice(0, 500) } });
      throw e; // BullMQ akan retry dengan exponential backoff
    }
  },
  { connection, concurrency: 5 },
);

/** Kirim event ke aplikasi billing eksisting (HMAC-SHA256 di header x-signature). */
new Worker(
  'billing-out',
  async (job: Job<{ id: string }>) => {
    const ev = await prisma.outboundEvent.findUnique({ where: { id: job.data.id } });
    if (!ev || ev.status === 'SENT') return;
    await prisma.outboundEvent.update({ where: { id: ev.id }, data: { attempts: { increment: 1 } } });
    try {
      if (!config.billing.webhookUrl) {
        console.log(`[billing dry-run] ${ev.event}`, JSON.stringify(ev.payload));
      } else {
        const body = JSON.stringify({ id: ev.id, event: ev.event, occurredAt: ev.createdAt, data: ev.payload });
        const sig = crypto.createHmac('sha256', config.billing.webhookSecret).update(body).digest('hex');
        const res = await fetch(config.billing.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-signature': sig, 'x-event': ev.event, 'idempotency-key': ev.id },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Billing ${res.status}`);
      }
      await prisma.outboundEvent.update({ where: { id: ev.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null } });
    } catch (e) {
      await prisma.outboundEvent.update({ where: { id: ev.id }, data: { status: 'FAILED', lastError: String(e).slice(0, 500) } });
      throw e;
    }
  },
  { connection, concurrency: 3 },
);

/** Job terjadwal: pengingat maintenance aset GA + sweeper outbox. */
new Worker(
  'cron',
  async (job: Job) => {
    if (job.name === 'maintenance-reminder') {
      // pembersihan rutin harian: notifikasi dalam aplikasi lebih dari 90 hari
      await prisma.inbox.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86400_000) } } }).catch((e) => console.error('bersihkan inbox gagal', e));
      // foto yang diunggah tetapi laporannya tidak pernah dikirim (tanpa WO > 2 hari): hapus berkas & catatan
      try {
        const orphans = await prisma.attachment.findMany({ where: { woId: null, kind: { in: ['REPORT', 'PROGRESS'] }, createdAt: { lt: new Date(Date.now() - 2 * 86400_000) } }, select: { id: true, url: true }, take: 500 });
        for (const a of orphans) await fs.promises.unlink(`${config.uploadDir}/${a.url.split('/').pop()}`).catch(() => {});
        if (orphans.length) await prisma.attachment.deleteMany({ where: { id: { in: orphans.map((a) => a.id) } } });
      } catch (e) { console.error('bersihkan foto yatim gagal', e); }
      const due = await prisma.asset.findMany({
        where: { needsMaintenance: true, nextMaintenanceAt: { lte: new Date(Date.now() + 7 * 86400_000) }, status: { in: ['IN_USE', 'IN_STOCK'] } },
        include: { item: true },
        orderBy: { nextMaintenanceAt: 'asc' },
      });
      if (!due.length) return;
      const jobs: QueuedJob[] = [];
      await prisma.$transaction(async (tx) => {
        const fx = new Effects(tx);
        await fx.notify({
          roles: ['GA'],
          subject: `Jadwal maintenance aset (${due.length} aset ≤ 7 hari)`,
          body: due.map((a) => `• ${a.assetCode ?? a.serialNumber} ${a.item.name} — ${a.nextMaintenanceAt?.toLocaleDateString('id-ID')}`).join('\n'),
        });
        jobs.push(...fx.jobs);
      });
      await enqueue(jobs);
    }
    if (job.name === 'radius-sync-now') {
      try { const r = await runSync('MANUAL', job.data?.userId); console.log('[radius] sinkron manual selesai', r); } catch (e) { console.error('[radius] sinkron manual gagal:', (e as Error).message); }
    }
    if (job.name === 'radius-tick') {
      // dipanggil tiap 5 menit: jalankan sinkron otomatis bila aktif dan sudah jatuh tempo
      const cfg = await getRadius();
      if (cfg.enabled && cfg.token && (!cfg.lastAutoAt || Date.now() - cfg.lastAutoAt >= cfg.intervalMin * 60_000)) {
        const cur = (await getSetting<any>('radius')) ?? {};
        await putSetting('radius', { ...cur, lastAutoAt: Date.now() });
        try { const r = await runSync('AUTO'); console.log('[radius] sinkron otomatis selesai', r); } catch (e) { console.error('[radius] sinkron otomatis gagal:', (e as Error).message); }
      }
    }
    if (job.name === 'sweep') {
      // re-enqueue outbox yang gagal ter-enqueue setelah commit (jobId mencegah duplikat)
      const cutoff = new Date(Date.now() - 2 * 60_000);
      const [n, o] = await Promise.all([
        prisma.notification.findMany({ where: { status: 'PENDING', createdAt: { lt: cutoff } }, take: 200 }),
        prisma.outboundEvent.findMany({ where: { status: 'PENDING', createdAt: { lt: cutoff } }, take: 200 }),
      ]);
      await enqueue([
        ...n.map((x) => ({ queue: 'notifications' as const, id: x.id })),
        ...o.map((x) => ({ queue: 'billing' as const, id: x.id })),
      ]);
    }
  },
  { connection },
);

(async () => {
  await cronQueue.add('maintenance-reminder', {}, { repeat: { pattern: '0 8 * * *', tz: 'Asia/Jakarta' }, jobId: 'maintenance-reminder' });
  await cronQueue.add('radius-tick', {}, { repeat: { every: 300_000 }, jobId: 'radius-tick' });
  await cronQueue.add('sweep', {}, { repeat: { every: 120_000 }, jobId: 'sweep' });
  console.log('Worker berjalan: notifications, billing-out, cron');
})();
