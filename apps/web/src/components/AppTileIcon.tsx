'use client';
import { fileUrl } from '@/lib/api';
import { AppIcon } from './appIcons';

/** Ikon ubin aplikasi: gambar unggahan sendiri (iconUrl) bila ada, selain itu ikon bawaan (Lucide) menurut kunci. */
export function AppTileIcon({ icon, iconUrl, size = 28 }: { icon: string; iconUrl?: string | null; size?: number }) {
  if (iconUrl) return <img src={fileUrl(iconUrl)} alt="" width={size} height={size} className="object-contain" style={{ width: size, height: size }} />;
  return <AppIcon name={icon} size={size} />;
}
