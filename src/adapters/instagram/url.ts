import { hostMatches, safeParseUrl } from '@/shared/url';

const HOSTS = ['instagram.com', 'instagr.am'];

/** /p/{code}, /reel/{code}, /reels/{code}, /tv/{code} — có thể có /{username} phía trước. */
const POST_PATH = /^\/(?:[^/]+\/)?(p|reels?|tv)\/([A-Za-z0-9_-]+)/;
/** Link chia sẻ /share/{mã} hoặc /share/{p|reel}/{mã}: Instagram tự chuyển sang link bài thật. */
const SHARE_PATH = /^\/share\/((?:p\/|reels?\/)?[A-Za-z0-9_-]+)/;

export function isInstagramHost(hostname: string): boolean {
  return HOSTS.some((h) => hostMatches(hostname, h));
}

function parse(input: string): { type: string; code: string } | null {
  const url = safeParseUrl(input);
  // /share/p/{mã} không phải /{username}/p/{mã}: mã chia sẻ khác shortcode của bài.
  if (!url || !isInstagramHost(url.hostname) || url.pathname.startsWith('/share/')) return null;
  const m = POST_PATH.exec(url.pathname);
  return m ? { type: m[1] === 'reels' ? 'reel' : m[1]!, code: m[2]! } : null;
}

function sharePath(input: string): string | null {
  const url = safeParseUrl(input);
  if (!url || !isInstagramHost(url.hostname)) return null;
  return SHARE_PATH.exec(url.pathname)?.[1] ?? null;
}

export const matchInstagramPostUrl = (input: string) =>
  parse(input) !== null || sharePath(input) !== null;

/** Mã bài (shortcode) trong link, để chọn đúng bài trong payload. Link share không có mã này. */
export const instagramShortcode = (input: string) => parse(input)?.code ?? null;

/** Chuẩn hóa: https://www.instagram.com/{p|reel|tv}/{code}/ — bỏ username, query, fragment. */
export function normalizeInstagramUrl(input: string): string {
  const p = parse(input);
  if (p) return `https://www.instagram.com/${p.type}/${p.code}/`;
  const share = sharePath(input);
  return share ? `https://www.instagram.com/share/${share}/` : input.trim();
}
