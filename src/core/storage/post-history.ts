import { browser } from 'wxt/browser';

/**
 * Mốc bình luận mới nhất đã lấy của từng bài (theo link đã chuẩn hóa), giữ qua các lần chạy.
 * Dùng cho chế độ "chỉ lấy bình luận mới": lần sau chỉ tải bình luận mới hơn mốc này.
 */

const KEY = 'postHistory';
/** Giữ tối đa bấy nhiêu bài gần nhất để storage không phình mãi. */
const MAX_POSTS = 2000;

interface PostHistoryEntry {
  /** ISO 8601 của bình luận gốc mới nhất đã lấy. */
  newestCommentAt: string;
  updatedAt: string;
}

type PostHistory = Record<string, PostHistoryEntry>;

async function readAll(): Promise<PostHistory> {
  const stored = await browser.storage.local.get(KEY);
  return (stored[KEY] as PostHistory | undefined) ?? {};
}

/** Mốc (giây Unix) của bài, hoặc null nếu chưa từng lấy đủ. */
export async function getNewestCommentTime(postUrl: string): Promise<number | null> {
  const entry = (await readAll())[postUrl];
  const ms = entry ? Date.parse(entry.newestCommentAt) : NaN;
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export async function recordNewestCommentTime(postUrl: string, newestAt: string): Promise<void> {
  const all = await readAll();
  const previous = all[postUrl]?.newestCommentAt;
  if (previous && Date.parse(previous) >= Date.parse(newestAt)) return;
  all[postUrl] = { newestCommentAt: newestAt, updatedAt: new Date().toISOString() };
  const keys = Object.keys(all);
  if (keys.length > MAX_POSTS) {
    keys
      .sort((a, b) => Date.parse(all[a]!.updatedAt) - Date.parse(all[b]!.updatedAt))
      .slice(0, keys.length - MAX_POSTS)
      .forEach((k) => delete all[k]);
  }
  await browser.storage.local.set({ [KEY]: all });
}
