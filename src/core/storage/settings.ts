import { browser } from 'wxt/browser';
import type { Range } from '@/shared/utils/delay';

export interface Settings {
  /** Độ trễ giữa các thao tác click/scroll (ms). */
  actionDelayMs: Range;
  /** Thời gian nghỉ giữa các bài (ms). */
  postDelayMs: Range;
  maxPostsPerHour: number;
  includeReplies: boolean;
  debugMode: boolean;
  /** Timeout mỗi bài (ms). */
  postTimeoutMs: number;
  /** Không có payload mới trong khoảng này (và hết nút tải thêm) thì coi như xong (ms). */
  idleStopMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  actionDelayMs: { min: 1000, max: 3000 },
  postDelayMs: { min: 5000, max: 15000 },
  maxPostsPerHour: 30,
  includeReplies: true,
  debugMode: false,
  postTimeoutMs: 10 * 60 * 1000,
  idleStopMs: 8000,
};

const KEY = 'settings';

/** Giới hạn dưới để không ai đặt về 0 và bỏ qua delay. */
export function sanitizeSettings(input: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...input };
  const range = (r: Range, floor: number): Range => {
    const min = Math.max(floor, Math.round(Math.min(r.min, r.max)));
    return { min, max: Math.max(min, Math.round(Math.max(r.min, r.max))) };
  };
  return {
    actionDelayMs: range(s.actionDelayMs, 500),
    postDelayMs: range(s.postDelayMs, 2000),
    maxPostsPerHour: Math.min(120, Math.max(1, Math.round(s.maxPostsPerHour))),
    includeReplies: !!s.includeReplies,
    debugMode: !!s.debugMode,
    postTimeoutMs: Math.max(60_000, Math.round(s.postTimeoutMs)),
    idleStopMs: Math.max(3000, Math.round(s.idleStopMs)),
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEY);
  return sanitizeSettings((stored[KEY] as Partial<Settings> | undefined) ?? {});
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = sanitizeSettings({ ...(await getSettings()), ...patch });
  await browser.storage.local.set({ [KEY]: next });
  return next;
}
