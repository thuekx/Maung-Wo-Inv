import { z } from 'zod';
import { fieldError, Tx } from './db';

/* Validasi jaringan: IP internal harus privat (RFC 1918), IP publik opsional, VLAN 1–4094, panjang & karakter ODP/port dibatasi. */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const octets = (s: string) => {
  const m = IPV4.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
};

/** 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 */
export const isPrivateIPv4 = (s: string) => {
  const o = octets(s);
  return !!o && (o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168));
};

/** Rentang yang bukan IP publik yang bisa dipakai pelanggan (loopback, link-local, CGNAT, multicast, dst). */
const isReserved = (s: string) => {
  const o = octets(s)!;
  return o[0] === 0 || o[0] === 127 || o[0] >= 224 || (o[0] === 169 && o[1] === 254) || (o[0] === 100 && o[1] >= 64 && o[1] <= 127);
};

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : v);
const blank = (v: unknown) => (v === '' || v === null ? undefined : clean(v));

/** IP internal pelanggan: "10.1.2.3" atau subnet "10.1.2.0/30" — wajib privat. */
export const internalIp = z.preprocess(
  blank,
  z.string().max(31).superRefine((v, ctx) => {
    const [addr, prefix, ...rest] = v.split('/');
    if (rest.length || !octets(addr)) return void ctx.addIssue({ code: 'custom', message: 'Format IP tidak valid (contoh 10.20.30.40 atau 10.20.30.0/30)' });
    if (prefix !== undefined && !(/^\d{1,2}$/.test(prefix) && +prefix >= 8 && +prefix <= 32)) return void ctx.addIssue({ code: 'custom', message: 'Prefix subnet harus 8–32' });
    if (!isPrivateIPv4(addr)) ctx.addIssue({ code: 'custom', message: 'IP harus privat (10.x.x.x, 172.16–31.x.x, atau 192.168.x.x). IP publik isi di kolom IP Publik' });
  }).optional(),
);

/** IP publik (opsional): harus IPv4 valid dan bukan privat/reserved. */
export const publicIp = z.preprocess(
  blank,
  z.string().max(15).superRefine((v, ctx) => {
    if (!octets(v)) return void ctx.addIssue({ code: 'custom', message: 'Format IP tidak valid (contoh 103.10.20.30)' });
    if (isPrivateIPv4(v) || isReserved(v)) ctx.addIssue({ code: 'custom', message: 'Bukan IP publik (rentang privat/khusus tidak diterima)' });
  }).optional(),
);

export const vlanId = z.preprocess(
  blank,
  z.coerce.number({ invalid_type_error: 'VLAN harus angka' }).int('VLAN harus bilangan bulat').min(1, 'VLAN minimal 1').max(4094, 'VLAN maksimal 4094').transform(String).optional(),
);

export const odpName = z.preprocess(blank, z.string().min(1).max(40, 'Maksimal 40 karakter').regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/, 'Hanya huruf, angka, spasi dan . _ / -').optional());
export const portName = z.preprocess(blank, z.string().min(1).max(20, 'Maksimal 20 karakter').regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Hanya huruf, angka dan . _ / -').optional());

/**
 * Cek bentrok sumber daya jaringan. IP & IP publik dibandingkan persis (nilai sama = bentrok); port = pasangan ODP+port.
 * Pelanggan TERMINATED/arsip tidak dihitung. `selfId` = pelanggan yang sedang diubah.
 */
export async function assertNetworkFree(tx: Tx, d: { ip?: string | null; publicIp?: string | null; odp?: string | null; port?: string | null }, selfId?: string) {
  const base = { id: selfId ? { not: selfId } : undefined, status: { not: 'TERMINATED' as const }, archivedAt: null };
  if (d.ip) {
    const dup = await tx.customer.findFirst({ where: { ip: d.ip, ...base } });
    if (dup) throw fieldError('ip', `IP ${d.ip} sudah dipakai ${dup.name} (${dup.code})`, 409);
  }
  if (d.publicIp) {
    const dup = await tx.customer.findFirst({ where: { publicIp: d.publicIp, ...base } });
    if (dup) throw fieldError('publicIp', `IP publik ${d.publicIp} sudah dipakai ${dup.name} (${dup.code})`, 409);
  }
  if (d.odp && d.port) {
    const dup = await tx.customer.findFirst({ where: { odp: d.odp, port: d.port, ...base } });
    if (dup) throw fieldError('port', `Port ${d.odp}/${d.port} sudah dipakai ${dup.name} (${dup.code})`, 409);
  }
}
