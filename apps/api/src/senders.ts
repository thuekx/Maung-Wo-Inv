import nodemailer, { Transporter } from 'nodemailer';
import { getSmtp, getTelegram, SmtpCfg } from './settings';

let cached: { sig: string; t: Transporter } | null = null;
const transportFor = (c: SmtpCfg) => {
  const sig = JSON.stringify([c.host, c.port, c.secure, c.user, c.pass]);
  if (cached?.sig === sig) return cached.t;
  const t = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure || c.port === 465,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  cached = { sig, t };
  return t;
};

/** Pengaturan diambil dari DB (menu Admin) lalu .env; tanpa host → dry-run. */
export async function sendEmail(to: string, subject: string, text: string) {
  const c = await getSmtp();
  if (!c.host) {
    console.log(`[email dry-run] → ${to} | ${subject}`);
    return 'dry-run';
  }
  await transportFor(c).sendMail({ from: c.from, to, subject, text });
  return 'sent';
}

export async function sendTelegram(chatId: string, text: string) {
  const { token } = await getTelegram();
  if (!token) {
    console.log(`[telegram dry-run] → ${chatId} | ${text.split('\n')[0]}`);
    return 'dry-run';
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  return 'sent';
}

/** Panggil Bot API (getMe, setWebhook, …) dan kembalikan `result`. */
export async function telegramApi<T = any>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(15_000),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.description ?? `Telegram ${res.status}`);
  return j.result as T;
}
