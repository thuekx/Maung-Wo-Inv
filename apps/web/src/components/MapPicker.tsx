'use client';
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { Modal } from './ui';

/** Pilih koordinat dari peta (OpenStreetMap): klik / geser penanda, lalu "Pakai titik ini". Butuh internet untuk ubin peta. */
export function MapPicker({ lat, lng, onPick, onClose }: { lat?: number; lng?: number; onPick: (lat: number, lng: number) => void; onClose: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [pt, setPt] = useState<{ lat: number; lng: number } | null>(lat != null && lng != null ? { lat, lng } : null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let map: import('leaflet').Map | undefined;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current) return;
      const start: [number, number] = lat != null && lng != null ? [lat, lng] : [-6.9175, 107.6191]; // bawaan: Bandung
      map = L.map(el.current).setView(start, lat != null ? 17 : 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' })
        .on('tileerror', () => setErr('Peta tidak dapat dimuat (butuh koneksi internet). Isi koordinat manual atau pakai lokasi sekarang.'))
        .addTo(map);
      const mk = L.circleMarker(start, { radius: 9, color: '#B91C1C', fillColor: '#F59E0B', fillOpacity: 0.9, weight: 3 });
      if (lat != null && lng != null) mk.addTo(map);
      map.on('click', (e: import('leaflet').LeafletMouseEvent) => { mk.setLatLng(e.latlng).addTo(map!); setPt({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }); });
      setTimeout(() => map?.invalidateSize(), 150);
    })();
    return () => { cancelled = true; map?.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Pilih lokasi dari peta" onClose={onClose} wide>
      <div ref={el} className="z-0 h-[55vh] w-full rounded-lg border" />
      {err && <p className="mt-2 text-xs font-medium text-red-600">{err}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-600">{pt ? <>Titik: <b className="font-mono">{pt.lat}, {pt.lng}</b></> : 'Klik pada peta untuk menandai lokasi.'}</span>
        <button type="button" className="btn" disabled={!pt} onClick={() => { if (pt) { onPick(pt.lat, pt.lng); onClose(); } }}>Pakai titik ini</button>
      </div>
    </Modal>
  );
}
