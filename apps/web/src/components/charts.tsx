'use client';
import { useState } from 'react';

/** Grafik SVG ringan tanpa dependensi; warna lewat currentColor / kelas Tailwind agar ikut tema. */

export function Donut({ pct, size = 132, stroke = 14, label, sub, color = '#10b981' }: { pct: number; size?: number; stroke?: number; label?: string; sub?: string; color?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative inline-block" style={{ width: size, height: size }} role="img" aria-label={`${label ?? 'Progres'} ${p}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-slate-200 dark:text-slate-700" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none">{p}%</span>
        {sub && <span className="mt-1 text-[11px] text-slate-500">{sub}</span>}
      </div>
    </div>
  );
}

export function ProgressBar({ value, max, color = '#2563eb', height = 8 }: { value: number; max: number; color?: string; height?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" style={{ height }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: 'width .5s ease' }} />
    </div>
  );
}

/** Bar horizontal bertumpuk: tiap baris = {label, segments:[{value,color,name}]}. */
export function StackedBars({ rows, total }: { rows: { label: string; segments: { value: number; color: string; name: string }[] }[]; total?: number }) {
  const max = total ?? Math.max(1, ...rows.map((r) => r.segments.reduce((a, s) => a + s.value, 0)));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const sum = r.segments.reduce((a, s) => a + s.value, 0);
        return (
          <div key={r.label}>
            <div className="mb-1 flex justify-between text-xs"><span className="text-slate-600">{r.label}</span><span className="font-medium">{sum}</span></div>
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" title={r.segments.map((s) => `${s.name}: ${s.value}`).join(' · ')}>
              {r.segments.map((s) => s.value > 0 && <div key={s.name} style={{ width: `${(s.value / max) * 100}%`, background: s.color }} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const Legend = ({ items }: { items: { name: string; color: string }[] }) => (
  <div className="flex flex-wrap gap-3 text-xs text-slate-500">{items.map((i) => <span key={i.name} className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.name}</span>)}</div>
);

/** Grafik garis/area dua seri (mis. WO dibuat vs selesai per hari). */
export function TrendChart({ data, series, height = 140 }: { data: { day: string; [k: string]: number | string }[]; series: { key: string; color: string; name: string }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = height, pad = { l: 24, r: 8, t: 8, b: 20 };
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]))));
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, data.length - 1);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = (k: string) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(d[k])).toFixed(1)}`).join(' ');
  const ticks = [0, Math.ceil(max / 2), max];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeDasharray="3 3" /><text x={pad.l - 4} y={y(t) + 3} textAnchor="end" fontSize="9" fill="currentColor" className="text-slate-400">{t}</text></g>
        ))}
        {series.map((s) => (
          <g key={s.key}>
            <path d={`${path(s.key)} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={s.color} opacity=".10" />
            <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {data.map((d, i) => (
          <g key={d.day}>
            {i % 3 === 0 && <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="currentColor" className="text-slate-400">{String(d.day).slice(5)}</text>}
            <rect x={x(i) - 10} y={0} width={20} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="currentColor" className="text-slate-400" />}
        {hover !== null && series.map((s) => <circle key={s.key} cx={x(hover)} cy={y(Number(data[hover][s.key]))} r="3.5" fill={s.color} />)}
      </svg>
      <div className="mt-1 flex items-center justify-between text-xs">
        <div className="flex gap-3">{series.map((s) => <span key={s.key} className="inline-flex items-center gap-1 text-slate-500"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.name}</span>)}</div>
        <span className="text-slate-500">{hover !== null ? `${data[hover].day}: ${series.map((s) => `${s.name} ${data[hover][s.key]}`).join(' · ')}` : 'Arahkan kursor ke grafik'}</span>
      </div>
    </div>
  );
}
