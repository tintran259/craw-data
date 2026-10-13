import { hostMatches, safeParseUrl } from '@/shared/url';

const HOSTS = ['x.com', 'twitter.com'];

/** /{user}/status/{id}, /i/web/status/{id}, /i/status/{id} */
const STATUS_PATH = /^\/(?:([^/]+)|i(?:\/web)?)\/status(?:es)?\/(\d+)/;

export function isXHost(hostname: string): boolean {
  return HOSTS.some((h) => hostMatches(hostname, h));
}

function parse(input: string): { user: string | null; id: string } | null {
  const url = safeParseUrl(input);
  if (!url || !isXHost(url.hostname)) return null;
  const m = STATUS_PATH.exec(url.pathname);
  if (!m) return null;
  const user = m[1] && m[1] !== 'i' ? m[1] : null;
  return { user, id: m[2]! };
}

export const matchXPostUrl = (input: string) => parse(input) !== null;

/** Id tweet gốc trong link. */
export const xStatusId = (input: string) => parse(input)?.id ?? null;

/** Chuẩn hóa: https://x.com/{user}/status/{id} (hoặc /i/status/{id} nếu link không có user). */
export function normalizeXUrl(input: string): string {
  const p = parse(input);
  if (!p) return input.trim();
  return `https://x.com/${p.user ?? 'i'}/status/${p.id}`;
}
