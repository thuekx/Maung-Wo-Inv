import crypto from 'crypto';
import { prisma } from './db';
import { getWhatsapp } from './settings';
import { kancaCall } from './senders';

/** Urutan status delivery: status lebih rendah tidak menimpa yang lebih tinggi (event webhook bisa datang tak berurutan). */
const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 9 };
const better = (cur: string | null | undefined, next: string) => (RANK[next] ?? 0) > (RANK[cur ?? ''] ?? 0);

/** Verifikasi X-Kanca-Signature (sha256=<hex> HMAC dari raw body). */
export function verifyKancaSignature(secret: string, raw: Buffer, header: string | undefined) {
  if (!secret || !header) return false;
  const exp = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const a = Buffer.from(header), b = Buffer.from(exp);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Simpan event webhook (idempoten per X-Kanca-Delivery-Id) dan perbarui status delivery notifikasi yang cocok. */
export async function ingestKancaEvent(event: string, deliveryId: string | null, payload: any) {
  try {
    await prisma.kancaEvent.create({ data: { event, deliveryId, payload } });
  } catch (e: any) {
    if (e?.code === 'P2002') return { duplicate: true }; // delivery yang sama sudah diproses
    throw e;
  }
  const wamid = payload?.source_id ?? payload?.messageId;
  const status = payload?.status ?? payload?.deliveryStatus;
  if ((event === 'message_created' || event === 'message_updated') && wamid && typeof status === 'string') {
    const n = await prisma.notification.findFirst({ where: { providerMsgId: String(wamid) } });
    if (n && better(n.providerStatus, status)) await prisma.notification.update({ where: { id: n.id }, data: { providerStatus: status, ...(status === 'failed' ? { error: String(payload?.error ?? 'Gagal terkirim (Meta)').slice(0, 300) } : {}) } });
  }
  return { duplicate: false };
}

/** Poller: tarik status delivery tiap broadcast yang pernah dikirim (cadangan bila webhook belum aktif / tidak datang). */
export async function syncKancaDelivery() {
  const c = await getWhatsapp();
  if (c.provider !== 'kanca' || !c.token || !c.workspaceId) return 0;
  const rows = await prisma.notification.findMany({
    where: { channel: 'WHATSAPP', providerRef: { not: null }, createdAt: { gt: new Date(Date.now() - 3 * 86400_000) }, OR: [{ providerStatus: null }, { providerStatus: { in: ['sent', 'delivered'] } }] },
    orderBy: { createdAt: 'asc' }, take: 40,
  });
  let n = 0;
  for (const r of rows) {
    try {
      const res = await kancaCall(c, 'GET', `/broadcasts/${encodeURIComponent(r.providerRef!)}?limit=1`);
      if (res.status >= 300) continue;
      const rec = res.json?.recipients?.[0];
      const st: string | undefined = rec?.deliveryStatus ?? (rec?.status === 'failed' ? 'failed' : rec?.status === 'sent' ? 'sent' : undefined);
      if (!st) continue;
      await prisma.notification.update({ where: { id: r.id }, data: { providerStatus: better(r.providerStatus, st) ? st : r.providerStatus ?? st, providerMsgId: rec?.messageId ?? r.providerMsgId, ...(st === 'failed' ? { error: String(rec?.error ?? 'Gagal terkirim (Meta)').slice(0, 300) } : {}) } });
      n++;
    } catch (e) { console.error('[kanca] sinkron', r.id, (e as Error).message); }
  }
  return n;
}

export async function cleanKancaEvents() {
  await prisma.kancaEvent.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - 30 * 86400_000) } } });
}
