import { facebookAdapter, facebookInfo } from './facebook';
import { instagramInfo } from './instagram';
import { threadsInfo } from './threads';
import { tiktokInfo } from './tiktok';
import type { Platform, PlatformAdapter, PlatformInfo } from './types';
import { xInfo } from './x';

/**
 * Nơi DUY NHẤT biết đến code riêng của từng nền tảng.
 * Thêm nền tảng mới: tạo thư mục adapter, rồi thêm vào hai danh sách dưới đây.
 */
const PLATFORMS: PlatformInfo[] = [facebookInfo, instagramInfo, threadsInfo, tiktokInfo, xInfo];

const ADAPTERS: Partial<Record<Platform, PlatformAdapter>> = {
  facebook: facebookAdapter,
};

export function detectPlatform(url: string): Platform | null {
  return PLATFORMS.find((p) => p.matchUrl(url))?.id ?? null;
}

export function getPlatformLabel(platform: Platform): string {
  return PLATFORMS.find((p) => p.id === platform)?.label ?? platform;
}

export function getAdapter(platform: Platform): PlatformAdapter | null {
  return ADAPTERS[platform] ?? null;
}

export function getAllAdapters(): PlatformAdapter[] {
  return Object.values(ADAPTERS);
}

/** Tìm adapter nhận link này là link bài viết hợp lệ. */
export function findAdapterForUrl(url: string): PlatformAdapter | null {
  return getAllAdapters().find((a) => a.matchUrl(url)) ?? null;
}
