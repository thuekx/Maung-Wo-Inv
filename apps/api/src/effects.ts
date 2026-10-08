import { Role, Prisma } from './orm';
import { prisma, Tx } from './db';
import { enqueue, QueuedJob } from './queue';
import { getTelegram } from './settings';

export interface NotifyOpts {
  roles?: Role[];
  userIds?: (string | null | undefined)[];
  emails?: string[]; // penerima eksternal (mis. pelanggan)
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
  constructor(public tx: Tx) {}

  async notify(o: NotifyOpts) {
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
    const add = (channel: 'EMAIL' | 'TELEGRAM', target: string | null | undefined, userId?: string) => {
      if (!target || seen.has(`${channel}:${target}`)) return;
      seen.add(`${channel}:${target}`);
      rows.push({ channel, target, userId, subject: o.subject, body: o.body, woId: o.woId });
    };

    for (const u of users) {
      add('EMAIL', u.email, u.id);
      add('TELEGRAM', u.telegramChatId, u.id);
    }
    const roleChats = (await getTelegram()).roleChats;
    for (const r of roles) add('TELEGRAM', roleChats[r]);
    for (const e of o.emails ?? []) add('EMAIL', e);

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
