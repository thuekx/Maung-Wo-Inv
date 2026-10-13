#!/usr/bin/env python3
"""Membangun apps/web/src/components/adminIcons.tsx (ikon navigasi Pusat Admin) dari Lucide (ISC), terpisah dari ikon ubin aplikasi.
Pakai:  mkdir /tmp/lucide && cd /tmp/lucide && npm pack lucide-static@0.468.0 && tar xzf lucide-static-*.tgz
        python3 scripts/gen-admin-icons.py /tmp/lucide/package"""
import re, sys
SRC = sys.argv[1]
KEYS = ['users', 'shield-check', 'layout-grid', 'palette', 'mail', 'send', 'message-circle', 'bell', 'globe', 'lock-keyhole', 'scroll-text', 'webhook', 'plug',
        'radio-tower', 'file-text', 'clipboard-list', 'file-check', 'qr-code', 'activity', 'database', 'settings', 'clipboard-check', 'cloud']
def jsx(inner):
    out = []
    for m in re.finditer(r'<(\w+)\s+([^>]*?)\s*/>', inner, re.S):
        out.append(f'<{m.group(1)} {re.sub(r"\s+", " ", m.group(2).strip())} />')
    return ''.join(out)
rows = []
for k in KEYS:
    svg = open(f'{SRC}/icons/{k}.svg').read()
    inner = re.search(r'<svg[^>]*>(.*)</svg>', svg, re.S).group(1)
    rows.append(f'  "{k}": <>{jsx(inner)}</>,')
body = '\n'.join(rows)
open('apps/web/src/components/adminIcons.tsx', 'w').write(f'''// DIHASILKAN oleh scripts/gen-admin-icons.py dari Lucide (ISC) — jangan disunting tangan.
import type {{ SVGProps }} from 'react';

const ICONS: Record<string, React.ReactNode> = {{
{body}
}};

/** Ikon navigasi Pusat Admin. */
export function AdminIcon({{ name, size = 18, className = '', ...rest }}: {{ name: string; size?: number; className?: string }} & Omit<SVGProps<SVGSVGElement>, 'name'>) {{
  return (
    <svg width={{size}} height={{size}} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={{1.8}} strokeLinecap="round" strokeLinejoin="round" className={{className}} aria-hidden="true" {{...rest}}>
      {{ICONS[name] ?? ICONS['settings']}}
    </svg>
  );
}}
''')
print('ok', len(KEYS))
