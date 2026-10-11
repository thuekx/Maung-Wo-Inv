#!/usr/bin/env python3
"""Membangun apps/web/src/components/appIcons.tsx + apps/api/src/appIcons.ts dari paket Lucide (ISC).
Pakai:  mkdir /tmp/lucide && cd /tmp/lucide && npm pack lucide-static@0.468.0 && tar xzf lucide-static-*.tgz
        python3 scripts/gen-app-icons.py /tmp/lucide/package
Daftar ikon dikurasi di CURATED di bawah (tambah di sini lalu jalankan ulang)."""
import re, sys, json, os

SRC = sys.argv[1]
# (kunci, label Indonesia, kelompok)
CURATED = [
  ('users', 'Tim / Pelanggan', 'Penjualan & CRM'), ('handshake', 'Kemitraan / Deal', 'Penjualan & CRM'), ('briefcase', 'Bisnis', 'Penjualan & CRM'),
  ('target', 'Target / Lead', 'Penjualan & CRM'), ('megaphone', 'Kampanye', 'Penjualan & CRM'), ('store', 'Toko / Outlet', 'Penjualan & CRM'),
  ('trending-up', 'Pertumbuhan', 'Penjualan & CRM'), ('chart-column', 'Laporan', 'Penjualan & CRM'), ('chart-line', 'Analitik', 'Penjualan & CRM'),
  ('contact', 'Kontak', 'Penjualan & CRM'), ('user-round-search', 'Prospek', 'Penjualan & CRM'), ('badge-percent', 'Promo', 'Penjualan & CRM'),
  ('map-pin', 'Lokasi', 'Aktivitas Lapangan'), ('map', 'Peta', 'Aktivitas Lapangan'), ('route', 'Rute Kunjungan', 'Aktivitas Lapangan'),
  ('navigation', 'Navigasi', 'Aktivitas Lapangan'), ('camera', 'Foto', 'Aktivitas Lapangan'), ('calendar-check', 'Jadwal', 'Aktivitas Lapangan'),
  ('clipboard-check', 'Work Order', 'Aktivitas Lapangan'), ('clipboard-list', 'Daftar Tugas', 'Aktivitas Lapangan'), ('clock', 'Waktu', 'Aktivitas Lapangan'),
  ('wifi', 'Internet', 'Jaringan & Teknis'), ('router', 'Perangkat', 'Jaringan & Teknis'), ('network', 'Jaringan', 'Jaringan & Teknis'),
  ('radio-tower', 'Tower / BTS', 'Jaringan & Teknis'), ('satellite-dish', 'Antena', 'Jaringan & Teknis'), ('cable', 'Kabel', 'Jaringan & Teknis'),
  ('server', 'Server', 'Jaringan & Teknis'), ('wrench', 'Perbaikan', 'Jaringan & Teknis'), ('hard-hat', 'Teknisi', 'Jaringan & Teknis'),
  ('package', 'Barang', 'Inventori & Keuangan'), ('boxes', 'Stok', 'Inventori & Keuangan'), ('warehouse', 'Gudang', 'Inventori & Keuangan'),
  ('truck', 'Pengiriman', 'Inventori & Keuangan'), ('wallet', 'Keuangan', 'Inventori & Keuangan'), ('receipt', 'Tagihan', 'Inventori & Keuangan'),
  ('hand-coins', 'Reimbursement', 'Inventori & Keuangan'), ('landmark', 'Bank', 'Inventori & Keuangan'),
  ('headset', 'Layanan Pelanggan', 'Umum'), ('message-circle', 'Pesan', 'Umum'), ('phone', 'Telepon', 'Umum'), ('file-text', 'Dokumen', 'Umum'),
  ('shield-check', 'Keamanan', 'Umum'), ('layout-grid', 'Aplikasi', 'Umum'), ('layout-dashboard', 'Dashboard', 'Umum'), ('settings', 'Pengaturan', 'Umum'),
  ('qr-code', 'QR', 'Umum'), ('ticket', 'Tiket', 'Umum'), ('building-2', 'Kantor', 'Umum'), ('layers', 'Master Data', 'Umum'), ('inbox', 'Kotak Masuk', 'Umum'),
]
# nama lama (ikon bawaan WO yang pernah tersimpan) → kunci baru
ALIAS = {'clipboard': 'clipboard-check', 'dashboard': 'layout-dashboard', 'box': 'package', 'trend': 'trending-up', 'pin': 'map-pin', 'qr': 'qr-code'}

def jsx(inner):
    out = []
    for m in re.finditer(r'<(\w+)\s+([^>]*?)\s*/>', inner, re.S):
        tag, attrs = m.group(1), m.group(2)
        attrs = re.sub(r'\s+', ' ', attrs.strip())
        out.append(f'<{tag} {attrs} />')
    return ''.join(out)

items = []
for key, label, group in CURATED:
    svg = open(os.path.join(SRC, 'icons', key + '.svg')).read()
    inner = svg[svg.index('>', svg.index('<svg')) + 1: svg.rindex('</svg>')]
    items.append((key, label, group, jsx(inner)))

lic = open(os.path.join(SRC, 'LICENSE')).read().strip()
lic_c = '\n'.join(' * ' + l if l else ' *' for l in lic.splitlines())
ts = f'''/**
 * Ikon aplikasi beranda — dikurasi dari Lucide (https://lucide.dev), lisensi ISC. DIHASILKAN oleh scripts/gen-app-icons.py; jangan disunting manual.
 *
{lic_c}
 */
import type {{ SVGProps }} from 'react';

export const APP_ICON_ALIAS: Record<string, string> = {json.dumps(ALIAS, ensure_ascii=False)};
export const APP_ICONS: {{ key: string; label: string; group: string; node: React.ReactNode }}[] = [
''' + ''.join(f"  {{ key: {json.dumps(k)}, label: {json.dumps(l, ensure_ascii=False)}, group: {json.dumps(g, ensure_ascii=False)}, node: <>{n}</> }},\n" for k, l, g, n in items) + f'''];
const BY_KEY = new Map(APP_ICONS.map((i) => [i.key, i]));

/** Ikon aplikasi (24×24, garis mengikuti warna teks). Kunci lama dialiaskan; tidak dikenal → ikon "Aplikasi". */
export function AppIcon({{ name, size = 24, className = '', ...rest }}: {{ name: string; size?: number; className?: string }} & Omit<SVGProps<SVGSVGElement>, 'name'>) {{
  const it = BY_KEY.get(APP_ICON_ALIAS[name] ?? name) ?? BY_KEY.get('layout-grid')!;
  return (
    <svg width={{size}} height={{size}} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={{1.8}} strokeLinecap="round" strokeLinejoin="round" className={{className}} aria-hidden="true" {{...rest}}>
      {{it.node}}
    </svg>
  );
}}
'''
ts = re.sub(r'(\w+)-(\w+)=', lambda m: m.group(0), ts)
# atribut SVG ber-strip → camelCase JSX
for a, b in (('stroke-linecap', 'strokeLinecap'), ('stroke-linejoin', 'strokeLinejoin'), ('stroke-width', 'strokeWidth')):
    ts = ts.replace(a + '=', b + '=')
open('apps/web/src/components/appIcons.tsx', 'w').write(ts)

keys = [k for k, *_ in CURATED] + list(ALIAS.keys()) + ['dashboard']
api = '/** Kunci ikon aplikasi yang diterima (DIHASILKAN oleh scripts/gen-app-icons.py; selaras dengan apps/web/src/components/appIcons.tsx). */\nexport const APP_ICON_KEYS = ' + json.dumps(sorted(set(keys))) + ' as const;\n'
open('apps/api/src/appIcons.ts', 'w').write(api)
print(len(items), 'ikon')
