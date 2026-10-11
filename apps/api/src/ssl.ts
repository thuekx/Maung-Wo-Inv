import fs from 'fs';
import path from 'path';
import tls from 'tls';
import dns from 'dns/promises';
import { getSetting, putSetting, refreshWebUrl } from './settings';

/**
 * SSL / domain (Let's Encrypt via Caddy). Admin mengatur domain + sakelar HTTPS + paksa-redirect; API menulis Caddyfile ke volume
 * bersama (CADDY_CONF_DIR) dan Caddy (`--watch`) memuat ulang otomatis. Sertifikat diterbitkan & DIPERPANJANG otomatis oleh Caddy
 * (±30 hari sebelum habis). Pengaman: redirect HTTP→HTTPS baru dinyalakan setelah sertifikat sah benar-benar terpasang,
 * dan `:80` tanpa-host selalu tetap melayani HTTP biasa (akses lewat IP / pemulihan bila SSL bermasalah).
 */
export interface SslCfg { enabled: boolean; forceRedirect: boolean; domain: string; email: string }
export const CADDY_DIR = process.env.CADDY_CONF_DIR ?? '/caddy-conf';
const CADDY_HOST = process.env.CADDY_HOST ?? 'caddy';
export const sslAvailable = () => fs.existsSync(CADDY_DIR);

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
export const validDomain = (d: string) => DOMAIN.test(d);

export async function getSsl(): Promise<SslCfg> {
  let s = (await getSetting<any>('ssl')) ?? {};
  // deploy.sh --domain <baru> mengganti WEB_DOMAIN di .env → pengaturan lama (domain sebelumnya) tidak dipakai lagi
  if ((s.envDomain ?? '') !== (process.env.WEB_DOMAIN ?? '')) s = {};
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : !!process.env.WEB_DOMAIN, // mode Caddy dipasang lewat deploy.sh --domain → SSL aktif bawaan
    forceRedirect: s.forceRedirect !== false, // bila SSL aktif: bawaan paksa HTTPS (setelah sertifikat terpasang)
    domain: typeof s.domain === 'string' ? s.domain.trim().toLowerCase() : (process.env.WEB_DOMAIN ?? '').toLowerCase(),
    email: typeof s.email === 'string' ? s.email.trim() : (process.env.ACME_EMAIL ?? ''),
  };
}

/** Isi Caddyfile menurut konfigurasi + apakah sertifikat sudah terpasang (menentukan redirect). */
/** Aplikasi lain di VM yang sama menaruh berkas *.caddy di proxy/sites/ (dipasang read-only ke /etc/caddy/sites). Wajib ada di level atas, setelah blok global. */
export const SITES_IMPORT = 'import /etc/caddy/sites/*.caddy';
/** Aplikasi di jalur domain WO yang sama (mis. /crm): berkas proxy/apps/*.caddy berisi `handle /crm/* { reverse_proxy crm-web:3000 }`; di-import DI DALAM tiap blok situs WO. */
export const APPS_IMPORT = 'import /etc/caddy/apps/*.caddy';
export function buildCaddyfile(c: SslCfg, certOk: boolean) {
  // lb_try_*: saat container web dibuat ulang (deploy/update) Caddy mencoba lagi sampai 20 dtk, bukan langsung 502
  // handle {} tanpa pencocok = jatuhan terakhir; `handle /jalur/*` dari proxy/apps diperiksa lebih dulu
  const proxy = `\t${APPS_IMPORT}\n\thandle {\n\t\treverse_proxy web:3000 {\n\t\t\tlb_try_duration 20s\n\t\t\tlb_try_interval 500ms\n\t\t}\n\t}`;
  const catchAll = `:80 {\n${proxy}\n}\n`; // akses lewat IP / hostname lain: HTTP biasa (jalur pemulihan)
  if (!c.enabled || !c.domain) return `{\n\tauto_https off\n}\n\n${SITES_IMPORT}\n\n${catchAll}`;
  const redirect = c.forceRedirect && certOk;
  const global = `{\n${c.email ? `\temail ${c.email}\n` : ''}${redirect ? '' : '\tauto_https disable_redirects\n'}}\n`;
  const httpsSite = `${c.domain} {\n${proxy}\n}\n`;
  // Tanpa redirect: domain tetap bisa dibuka lewat HTTP biasa (sambil menunggu sertifikat / bila redirect dimatikan)
  const httpSite = redirect ? '' : `\nhttp://${c.domain} {\n${proxy}\n}\n`;
  return `${global}\n${SITES_IMPORT}\n\n${httpsSite}${httpSite}\n${catchAll}`;
}

export interface CertStatus { reachable: boolean; ok: boolean; issuer?: string; validTo?: string; daysLeft?: number; error?: string }
/** Baca sertifikat yang sedang disajikan Caddy untuk domain (koneksi TLS di jaringan docker). */
export function certStatus(domain: string, timeoutMs = 4000): Promise<CertStatus> {
  return new Promise((resolve) => {
    if (!domain) return resolve({ reachable: false, ok: false, error: 'Domain belum diisi' });
    const done = (r: CertStatus) => { try { sock.destroy(); } catch { /* sudah tertutup */ } resolve(r); };
    const sock = tls.connect({ host: CADDY_HOST, port: 443, servername: domain, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const c = sock.getPeerCertificate();
      if (!c || !c.valid_to) return done({ reachable: true, ok: false, error: 'Caddy belum menyajikan sertifikat untuk domain ini' });
      const validTo = new Date(c.valid_to);
      const issuer = (c.issuer?.O ?? c.issuer?.CN ?? '') as string;
      const selfSigned = JSON.stringify(c.issuer) === JSON.stringify(c.subject) || /caddy local|internal/i.test(String(c.issuer?.CN ?? ''));
      const daysLeft = Math.floor((validTo.getTime() - Date.now()) / 86400_000);
      const names = `${c.subject?.CN ?? ''} ${c.subjectaltname ?? ''}`.toLowerCase();
      const forDomain = names.includes(domain.toLowerCase());
      done({ reachable: true, ok: !selfSigned && daysLeft > 0 && forDomain, issuer, validTo: validTo.toISOString(), daysLeft, ...(selfSigned ? { error: 'Sertifikat swa-tanda-tangan (belum dari Let\'s Encrypt)' } : !forDomain ? { error: 'Sertifikat bukan untuk domain ini' } : {}) });
    });
    sock.on('error', (e) => done({ reachable: false, ok: false, error: `Tidak tersambung ke Caddy: ${e.message}` }));
    sock.on('timeout', () => done({ reachable: false, ok: false, error: 'Waktu habis menyambung ke Caddy' }));
  });
}

/** Cek DNS domain → alamat IP (bantuan diagnosis: domain harus mengarah ke server ini). */
export async function dnsCheck(domain: string) {
  try { return (await dns.resolve4(domain)).sort(); } catch { return []; }
}

let lastWritten = '';
export function writeCaddyfile(content: string) {
  if (!sslAvailable()) return false;
  const file = path.join(CADDY_DIR, 'Caddyfile');
  if (content === lastWritten) { try { if (fs.readFileSync(file, 'utf8') === content) return false; } catch { /* tulis ulang */ } }
  fs.writeFileSync(file, content); // tulis langsung (bukan rename) agar `caddy --watch` mendeteksi perubahan
  lastWritten = content;
  return true;
}

/** Terapkan konfigurasi: simpan, tulis Caddyfile, sesuaikan URL aplikasi (tautan notifikasi). */
export async function applySsl(cfg: SslCfg, userId?: string) {
  const cert = cfg.enabled && cfg.domain ? await certStatus(cfg.domain) : { ok: false };
  const wrote = writeCaddyfile(buildCaddyfile(cfg, !!cert.ok));
  const old = (await getSetting<any>('ssl')) ?? {};
  await putSetting('ssl', { ...old, ...cfg, envDomain: process.env.WEB_DOMAIN ?? '' }, userId);
  if (cfg.domain) {
    const app = (await getSetting<any>('app')) ?? {};
    await putSetting('app', { ...app, publicUrl: `${cfg.enabled ? 'https' : 'http'}://${cfg.domain}` }, userId);
    await refreshWebUrl();
  }
  return { wrote, cert };
}

/** Putaran berkala: saat SSL aktif & redirect diminta tetapi belum aktif, nyalakan redirect begitu sertifikat sah terdeteksi. */
export function startSslWatcher() {
  if (!sslAvailable()) return;
  const tick = async () => {
    try {
      const c = await getSsl();
      if (!c.enabled || !c.domain) return;
      const cert = await certStatus(c.domain);
      writeCaddyfile(buildCaddyfile(c, cert.ok));
    } catch { /* coba lagi putaran berikutnya */ }
  };
  setTimeout(tick, 15_000).unref();
  setInterval(tick, 60_000).unref();
}
