import { getPlatformLabel } from '@/adapters/registry';
import type { Platform } from '@/adapters/types';

const COLORS: Record<Platform, string> = {
  facebook: 'bg-blue-100 text-blue-800',
  instagram: 'bg-pink-100 text-pink-800',
  threads: 'bg-neutral-200 text-neutral-800',
  tiktok: 'bg-cyan-100 text-cyan-800',
  x: 'bg-slate-200 text-slate-800',
};

export function PlatformBadge({ platform }: { platform: Platform | null }) {
  if (!platform) return null;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${COLORS[platform]}`}>
      {getPlatformLabel(platform)}
    </span>
  );
}
