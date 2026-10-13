import { hostMatches, safeParseUrl } from '@/shared/url';

const HOSTS = ['threads.net', 'threads.com'];

/** /@{username}/post/{code} */
const POST_PATH = /^\/@([^/]+)\/post\/([A-Za-z0-9_-]+)/;
/** Link chia sẻ /share/{mã}: Threads tự chuyển sang link bài thật bằng JavaScript sau khi mở. */
const SHARE_PATH = /^\/share\/([A-Za-z0-9_-]+)/;

export function isThreadsHost(hostname: string): boolean {
  return HOSTS.some((h) => hostMatches(hostname, h));
}

function parse(input: string): { user: string; code: string } | null {
  const url = safeParseUrl(input);
  if (!url || !isThreadsHost(url.hostname)) return null;
  const m = POST_PATH.exec(url.pathname);
  return m ? { user: m[1]!, code: m[2]! } : null;
}

function shareToken(input: string): string | null {
  const url = safeParseUrl(input);
  if (!url || !isThreadsHost(url.hostname)) return null;
  return SHARE_PATH.exec(url.pathname)?.[1] ?? null;
}

export const matchThreadsPostUrl = (input: string) =>
  parse(input) !== null || shareToken(input) !== null;

/** Mã bài trong link — để loại bài gốc khỏi danh sách bình luận. Link share không có mã này. */
export const threadsPostCode = (input: string | null | undefined) =>
  input ? (parse(input)?.code ?? null) : null;

/**
 * Chuẩn hóa: https://www.threads.com/@{user}/post/{code} (threads.net đã chuyển sang .com);
 * link chia sẻ giữ dạng https://www.threads.com/share/{mã}/.
 */
export function normalizeThreadsUrl(input: string): string {
  const p = parse(input);
  if (p) return `https://www.threads.com/@${p.user}/post/${p.code}`;
  const token = shareToken(input);
  return token ? `https://www.threads.com/share/${token}/` : input.trim();
}
