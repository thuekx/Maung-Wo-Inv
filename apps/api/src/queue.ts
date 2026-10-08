import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config';

export const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

export const notificationQueue = new Queue('notifications', { connection });
export const billingQueue = new Queue('billing-out', { connection });
export const cronQueue = new Queue('cron', { connection });

export type QueuedJob = { queue: 'notifications' | 'billing'; id: string };

const opts = (id: string) => ({
  jobId: id, // dedupe: satu baris DB = satu job
  attempts: 6,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
});

export async function enqueue(jobs: QueuedJob[]) {
  for (const j of jobs) {
    const q = j.queue === 'notifications' ? notificationQueue : billingQueue;
    await q.add(j.queue, { id: j.id }, opts(j.id));
  }
}

/** Kirim ulang notifikasi: jobId unik agar tidak dianggap duplikat job lama. */
export async function requeueNotification(id: string) {
  await notificationQueue.add('notifications', { id }, { ...opts(`${id}-r${Date.now()}`) });
}
