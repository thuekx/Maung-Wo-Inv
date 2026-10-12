'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Menanam halaman aplikasi lain (se-origin, mis. /crm/admin/settings) ke dalam Pusat Admin.
 * Aplikasi tertanam wajib: `?embed=1` (tanpa header/sidebar), frame-ancestors 'self', dan mengirim
 * window.parent.postMessage({ type: 'maung-embed-height', height }, location.origin) agar kotak pas tanpa scroll ganda.
 */
export function EmbedFrame({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(640);
  const [loaded, setLoaded] = useState(false);
  const url = `${src}${src.includes('?') ? '&' : '?'}embed=1`;
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== ref.current?.contentWindow) return;
      const d = e.data as { type?: string; height?: number };
      if (d?.type === 'maung-embed-height' && Number.isFinite(d.height)) setHeight(Math.max(320, Math.ceil(d.height as number) + 8));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{loaded ? '' : 'Memuat…'}</span>
        <a href={src} className="underline hover:text-slate-700">Buka di jendela penuh ↗</a>
      </div>
      <iframe ref={ref} key={url} src={url} title={title} onLoad={() => setLoaded(true)} className="w-full border-0 bg-transparent" style={{ height }} scrolling="no" />
    </div>
  );
}
