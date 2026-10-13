import { browser } from 'wxt/browser';
import type { Range } from '@/shared/utils/delay';

export interface Settings {
  /** Độ trễ giữa các thao tác click/scroll (ms). */
  actionDelayMs: Range;
  /** Thời gian nghỉ giữa các bài (ms). */
  postDelayMs: Range;
  maxPostsPerHour: number;
  /** Số cấp reply cần lấy: 0 = không lấy, 1 = chỉ reply của bình luận gốc, 2 = tất cả. */
  replyDepth: ReplyDepth;
  /** Chế độ nhanh: gọi thẳng API phân trang của Facebook thay vì bấm nút. */
  fastMode: boolean;
  /** Độ trễ giữa các request API ở chế độ nhanh (ms), tính riêng cho từng luồng. */
  apiDelayMs: Range;
  /** Số luồng tải reply chạy song song với chuỗi bình luận gốc (chế độ nhanh). */
  replyLanes: number;
  /** Thử nghiệm: dò feedLocation cho trang lớn hơn (có thể bỏ sót dữ liệu). */
  probeFeedLocation: boolean;
  /** Số bài chạy cùng lúc (mỗi bài một cửa sổ). */
  parallelPosts: number;
  /** Chỉ lấy bình luận mới hơn lần chạy trước của cùng bài (Facebook, chế độ nhanh). */
  onlyNewComments: boolean;
  /** Dừng mỗi bài khi đã lấy đủ số bình luận này; 0 = không giới hạn. */
  maxCommentsPerPost: number;
  debugMode: boolean;
  /** Timeout mỗi bài (ms). */
  postTimeoutMs: number;
  /** Không có payload mới trong khoảng này (và hết nút tải thêm) thì coi như xong (ms). */
  idleStopMs: number;
}

export type ReplyDepth = 0 | 1 | 2;

export const DEFAULT_SETTINGS: Settings = {
  actionDelayMs: { min: 1000, max: 3000 },
  postDelayMs: { min: 5000, max: 15000 },
  maxPostsPerHour: 30,
  replyDepth: 2,
  fastMode: true,
  apiDelayMs: { min: 500, max: 1000 },
  replyLanes: 2,
  probeFeedLocation: false,
  parallelPosts: 1,
  onlyNewComments: false,
  maxCommentsPerPost: 0,
  debugMode: false,
  // Bài hàng chục nghìn bình luận cần cả giờ (Facebook chỉ trả 10 bình luận gốc mỗi request);
  // hết giờ vẫn bấm "Chạy tiếp" được nhờ checkpoint.
  postTimeoutMs: 120 * 60 * 1000,
  idleStopMs: 8000,
};

const KEY = 'settings';

/** Giới hạn dưới để không ai đặt về 0 và bỏ qua delay. */
export function sanitizeSettings(
  input: Partial<Settings> & { includeReplies?: boolean },
): Settings {
  const s = { ...DEFAULT_SETTINGS, ...input };
  // Cài đặt cũ chỉ có bật/tắt reply.
  const legacyDepth = input.includeReplies === false ? 0 : DEFAULT_SETTINGS.replyDepth;
  const depth = Math.round(Number(input.replyDepth ?? legacyDepth));
  const int = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
  const range = (r: Range, floor: number): Range => {
    const min = Math.max(floor, Math.round(Math.min(r.min, r.max)));
    return { min, max: Math.max(min, Math.round(Math.max(r.min, r.max))) };
  };
  return {
    actionDelayMs: range(s.actionDelayMs, 500),
    postDelayMs: range(s.postDelayMs, 2000),
    maxPostsPerHour: int(s.maxPostsPerHour, 1, 120),
    replyDepth: (depth >= 0 && depth <= 2 ? depth : DEFAULT_SETTINGS.replyDepth) as ReplyDepth,
    fastMode: !!s.fastMode,
    apiDelayMs: range(s.apiDelayMs, 300),
    replyLanes: int(s.replyLanes, 1, 4),
    probeFeedLocation: !!s.probeFeedLocation,
    parallelPosts: int(s.parallelPosts, 1, 4),
    onlyNewComments: !!s.onlyNewComments,
    maxCommentsPerPost: int(s.maxCommentsPerPost, 0, 10_000_000),
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
