import { hostMatches, safeParseUrl } from '@/shared/url';

const FB_HOSTS = ['facebook.com', 'fb.com'];

/** Các dạng đường dẫn bài viết được hỗ trợ. */
const POST_PATH_PATTERNS: RegExp[] = [
  /^\/[^/]+\/posts\/[^/]+/, // /{page|user}/posts/{id}
  /^\/groups\/[^/]+\/(posts|permalink)\/[^/]+/, // /groups/{g}/posts/{id}
  /^\/permalink\.php$/,
  /^\/story\.php$/,
  /^\/share\/(p|r|v)\/[^/]+/, // /share/p/{code}, reel/video share
  /^\/photo(\.php)?\/?$/, // /photo/?fbid= , /photo.php?fbid=
  /^\/[^/]+\/photos\/.+/, // /{page}/photos/a.{album}/{id}
  /^\/reel\/[^/]+/,
  /^\/([^/]+\/)?videos\/.+/, // /{page}/videos/{id}, /videos/{id}
  /^\/watch\/?$/, // /watch/?v=
];

/** Query param cần giữ để link vẫn trỏ đúng bài; các param khác (tracking) bị bỏ. */
const KEEP_PARAMS = ['story_fbid', 'id', 'fbid', 'set', 'v'];

/** Path cần các param bắt buộc mới xác định được bài viết. */
const REQUIRED_PARAMS: Record<string, string[]> = {
  '/permalink.php': ['story_fbid'],
  '/story.php': ['story_fbid'],
  '/photo': ['fbid'],
  '/photo.php': ['fbid'],
  '/watch': ['v'],
};

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function isFacebookHost(hostname: string): boolean {
  return FB_HOSTS.some((h) => hostMatches(hostname, h));
}

export function matchFacebookPostUrl(input: string): boolean {
  const url = safeParseUrl(input);
  if (!url || !isFacebookHost(url.hostname)) return false;
  const path = url.pathname;
  if (!POST_PATH_PATTERNS.some((re) => re.test(path))) return false;
  const required = REQUIRED_PARAMS[stripTrailingSlash(path)];
  return !required || required.every((p) => url.searchParams.get(p));
}

/**
 * Chuẩn hóa link: luôn dùng https://www.facebook.com, bỏ fragment, bỏ param tracking,
 * bỏ dấu `/` cuối. Dùng để khử trùng lặp link.
 */
export function normalizeFacebookUrl(input: string): string {
  const url = safeParseUrl(input);
  if (!url) return input.trim();
  const out = new URL('https://www.facebook.com');
  out.pathname = stripTrailingSlash(url.pathname);
  for (const key of KEEP_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) out.searchParams.set(key, value);
  }
  return out.toString();
}
