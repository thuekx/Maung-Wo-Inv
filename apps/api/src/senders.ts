import nodemailer, { Transporter } from 'nodemailer';
import { getAppName, getSmtp, getTelegram, SmtpCfg } from './settings';

/** Alamat pengirim dengan nama tampilan = nama aplikasi ("MAUNG | SuperApps" <noreply@…>). */
export const fromHeader = (from: string, appName: string) => { const m = /<([^>]+)>/.exec(from) ?? /([^\s<>"]+@[^\s<>"]+)/.exec(from); return m ? `"${appName.replace(/"/g, '')}" <${m[1]}>` : from; };

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
  if (!c.enabled) return 'disabled'; // sakelar email dimatikan Admin (mis. saat uji coba/demo)
  const app = await getAppName();
  await transportFor(c).sendMail({ from: fromHeader(c.from, app), to, subject, text: `${text}\n\n—\n${app}` });
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
