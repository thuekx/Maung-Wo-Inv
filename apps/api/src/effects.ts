import { Role, Prisma } from './orm';
import { prisma, Tx } from './db';
import { enqueue, QueuedJob } from './queue';
import { getTelegram } from './settings';

export interface NotifyOpts {
  /** false = jangan simpan di kotak masuk dalam aplikasi (mis. pesan berisi password sementara) */
  inbox?: boolean;
  roles?: Role[];
  userIds?: (string | null | undefined)[];
  emails?: string[]; // penerima eksternal (mis. pelanggan)
  whatsapps?: string[]; // nomor WhatsApp penerima eksternal
  telegrams?: string[]; // chat id Telegram penerima eksternal
  subject: string;
  body: string;
  woId?: string;
}

/**
 * Efek samping (notifikasi email/Telegram + event ke billing) ditulis ke DB di dalam
 * transaksi yang sama dengan perubahan WO, lalu di-enqueue ke BullMQ setelah commit.
 * Dengan begitu tidak ada notifikasi untuk transaksi yang gagal (outbox pattern).
 */
export class Effects {
  jobs: QueuedJob[] = [];
  private demoWo = new Map<string, boolean>();
  constructor(public tx: Tx) {}

  /** WO uji sambung CRM (source CRM_DEMO)? */
  private async isDemo(woId?: string) {
    if (!woId) return false;
    if (!this.demoWo.has(woId)) this.demoWo.set(woId, (await this.tx.workOrder.findUnique({ where: { id: woId }, select: { source: true } }))?.source === 'CRM_DEMO');
    return this.demoWo.get(woId)!;
  }

  async notify(o0: NotifyOpts) {
    // uji sambung: hanya kotak masuk dalam aplikasi (diberi label [DEMO]); tidak ada email/Telegram/WhatsApp ke siapa pun (pelanggan demo maupun tim)
    const demo = await this.isDemo(o0.woId);
    const o: NotifyOpts = demo ? { ...o0, subject: `[DEMO] ${o0.subject}`, emails: [], whatsapps: [], telegrams: [] } : o0;
    const ids = (o.userIds ?? []).filter((x): x is string => !!x);
    const roles = o.roles ?? [];
    const users =
      ids.length || roles.length
        ? await this.tx.user.findMany({
            where: { active: true, OR: [{ role: { in: roles } }, { id: { in: ids } }] },
          })
        : [];

    const seen = new Set<string>();
    const rows: Prisma.NotificationCreateManyInput[] = [];
    const add = (channel: 'EMAIL' | 'TELEGRAM' | 'WHATSAPP', target: string | null | undefined, userId?: string) => {
      if (!target || seen.has(`${channel}:${target}`)) return;
      seen.add(`${channel}:${target}`);
      rows.push({ channel, target, userId, subject: o.subject, body: o.body, woId: o.woId });
    };

    if (!demo) for (const u of users) {
      add('EMAIL', u.email, u.id);
      add('TELEGRAM', u.telegramChatId, u.id);
    }
    const roleChats = (await getTelegram()).roleChats;
    if (!demo) for (const r of roles) add('TELEGRAM', roleChats[r]);
    for (const e of o.emails ?? []) add('EMAIL', e);
    for (const w of o.whatsapps ?? []) add('WHATSAPP', w);
    for (const t of o.telegrams ?? []) add('TELEGRAM', t);

    // kotak masuk dalam aplikasi (lonceng): sekali per pengguna, tidak bergantung pada sukses kirim email/Telegram
    if (users.length && o.inbox !== false) await this.tx.inbox.createMany({ data: users.map((u) => ({ userId: u.id, subject: o.subject, body: o.body, woId: o.woId })) });

    for (const row of rows) {
      const n = await this.tx.notification.create({ data: row });
      this.jobs.push({ queue: 'notifications', id: n.id });
    }
  }

  /** Event ke aplikasi billing/finance eksisting. */
  async emit(event: string, payload: Record<string, unknown>) {
    const row = await this.tx.outboundEvent.create({ data: { event, payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue } });
    this.jobs.push({ queue: 'billing', id: row.id });
  }
}

export async function transact<T>(fn: (fx: Effects) => Promise<T>): Promise<T> {
  let fx!: Effects;
  const result = await prisma.$transaction(
    async (tx) => {
      fx = new Effects(tx);
      return fn(fx);
    },
    { timeout: 30_000 },
  );
  await enqueue(fx.jobs).catch((e) => console.error('enqueue gagal (akan di-sweep):', e));
  return result;
}
