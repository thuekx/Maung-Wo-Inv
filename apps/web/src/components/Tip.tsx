'use client';
/** Tooltip instan saat hover/fokus (atribut `title` bawaan browser muncul lambat dan tidak terlihat di layar sentuh). */
export function Tip({ label, children, align = 'center', disabled }: { label: string; children: React.ReactNode; align?: 'center' | 'right' | 'left'; disabled?: boolean }) {
  if (disabled) return <span className="inline-flex">{children}</span>;
  const pos = align === 'right' ? 'right-0' : align === 'left' ? 'left-0' : 'left-1/2 -translate-x-1/2';
  return (
    <span className="group relative inline-flex">
      {children}
      <span role="tooltip" className={`pointer-events-none absolute top-full z-[60] mt-2 w-max max-w-[220px] rounded-md bg-slate-900 px-2.5 py-1.5 text-center text-xs font-medium leading-snug text-white opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 ${pos}`}>{label}</span>
    </span>
  );
}
