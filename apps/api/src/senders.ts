import nodemailer, { Transporter } from 'nodemailer';
import { getAppName, getSmtp, getTelegram, getWhatsapp, SmtpCfg, WhatsappCfg } from './settings';

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

/** Nomor WhatsApp → format internasional tanpa "+" (0812… → 62812…). */
export const waNumber = (raw: string) => { const d = raw.replace(/\D/g, ''); return d.startsWith('0') ? `62${d.slice(1)}` : d.startsWith('8') ? `62${d}` : d; };

/** Kirim 1 pesan lewat gateway WhatsApp yang diatur Admin. Sakelar mati → 'disabled' (tidak ada biaya). */
/** Panggil API Kanca (Bearer ib_…). Galat dibungkus pesan Indonesia; respons dikembalikan apa adanya. */
export async function kancaCall(c: WhatsappCfg, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: any }> {
  if (!c.token) throw new Error('API key Kanca belum diisi');
  if (!c.workspaceId) throw new Error('Workspace ID Kanca belum diisi');
  const res = await fetch(`${c.baseUrl}/api/v1/workspaces/${encodeURIComponent(c.workspaceId)}${path}`, {
    method, headers: { Authorization: `Bearer ${c.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
  });
  const raw = await res.text();
  let json: any = null; try { json = JSON.parse(raw); } catch { json = raw.slice(0, 500); }
  return { status: res.status, json };
}
const kancaErr = (r: { status: number; json: any }) => `Kanca ${r.status}${r.json?.error?.code ? ` ${r.json.error.code}` : ''}: ${(r.json?.error?.message ?? (typeof r.json === 'string' ? r.json : JSON.stringify(r.json))).toString().slice(0, 200)}`;
/** Variabel template WhatsApp tidak boleh berisi baris baru / spasi berderet (aturan Meta). */
const waVar = (t: string) => t.replace(/\s*\n+\s*/g, ' | ').replace(/[ \t]{2,}/g, ' ').trim().slice(0, 900) || '-';

export async function sendWhatsApp(to: string, text: string, cfgIn?: WhatsappCfg, force = false, parts?: { subject: string; body: string }) {
  const c = cfgIn ?? (await getWhatsapp());
  if (!c.token || !c.baseUrl || (c.provider === 'kanca' && !c.workspaceId)) { console.log(`[whatsapp dry-run] → ${to}`); return 'dry-run'; }
  if (!c.enabled && !force) return 'disabled';
  const number = waNumber(to);
  if (!/^\d{9,15}$/.test(number)) throw new Error(`Nomor WhatsApp tidak valid: ${to}`);
  if (c.provider === 'kanca') {
    // Notifikasi sering di luar jendela 24 jam → pakai template APPROVED (broadcast 1 penerima); tanpa templateId → teks bebas (hanya dalam 24 jam).
    const sub = parts?.subject ?? '', body = parts?.body ?? text;
    const r = c.templateId
      ? await kancaCall(c, 'POST', '/broadcasts', { name: `Maung ${new Date().toISOString().slice(0, 19)}`, templateId: c.templateId, ...(c.channelId ? { channelId: c.channelId } : {}), recipients: [{ phoneNumber: number, variables: c.varMode === '2' ? { '1': waVar(sub), '2': waVar(body) } : { '1': waVar(`${sub}${sub ? ' — ' : ''}${body}`) } }] })
      : await kancaCall(c, 'POST', '/send', { channel: 'waba', ...(c.channelId ? { channelId: c.channelId } : {}), to: number, text });
    if (r.status >= 300) throw new Error(kancaErr(r));
    return 'sent';
  }
  let res: Response;
  if (c.provider === 'fonnte') {
    res = await fetch(`${c.baseUrl}/send`, { method: 'POST', headers: { Authorization: c.token, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ target: number, message: text, countryCode: '62' }), signal: AbortSignal.timeout(20_000) });
  } else {
    const body = c.bodyTemplate.replace(/\{\{\s*to\s*\}\}/g, JSON.stringify(number)).replace(/\{\{\s*message\s*\}\}/g, JSON.stringify(text));
    res = await fetch(c.baseUrl, { method: 'POST', headers: { [c.headerName]: c.token, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(20_000) });
  }
  const raw = await res.text();
  let j: any = null; try { j = JSON.parse(raw); } catch { /* bukan JSON */ }
  if (!res.ok || j?.status === false) throw new Error(`WhatsApp ${res.status}: ${(j?.reason ?? j?.message ?? raw).toString().slice(0, 200)}`);
  return 'sent';
}
