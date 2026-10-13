import {
  detectPlatform,
  findAdapterForUrl,
  getAdapter,
  getPlatformLabel,
} from '@/adapters/registry';
import type { Platform } from '@/adapters/types';
import { safeParseUrl } from '@/shared/url';

/** Gợi ý dạng link bài viết khi người dùng dán link trang cá nhân / trang chủ. */
const POST_LINK_HINT: Partial<Record<Platform, string>> = {
  facebook: '/posts/, /reel/, /share/p/, ...',
  instagram: '/p/{mã}, /reel/{mã}, /share/{mã}',
  threads: '/@{tên}/post/{mã}, /share/{mã}',
  x: '/{tên}/status/{id}',
};

export interface ParsedLink {
  inputUrl: string;
  normalizedUrl: string;
  platform: Platform | null;
  supported: boolean;
}

export interface RejectedLink {
  line: number;
  text: string;
  reason: string;
}

export interface LinkParseResult {
  links: ParsedLink[];
  rejected: RejectedLink[];
}

/** Phân tích textarea: mỗi dòng một link; bỏ dòng trống, link trùng, link không hợp lệ. */
export function parseLinkInput(text: string): LinkParseResult {
  const links: ParsedLink[] = [];
  const rejected: RejectedLink[] = [];
  const seen = new Map<string, number>();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const lineNo = index + 1;
    if (!safeParseUrl(line)) {
      rejected.push({ line: lineNo, text: line, reason: 'Không phải link hợp lệ' });
      return;
    }
    const adapter = findAdapterForUrl(line);
    const platform = adapter?.id ?? detectPlatform(line);
    if (!platform) {
      rejected.push({ line: lineNo, text: line, reason: 'Không nhận diện được mạng xã hội' });
      return;
    }
    if (!adapter && getAdapter(platform)) {
      rejected.push({
        line: lineNo,
        text: line,
        reason: `Không phải link bài viết ${getPlatformLabel(platform)} (cần link ${POST_LINK_HINT[platform] ?? 'bài viết'})`,
      });
      return;
    }
    const normalizedUrl = adapter ? adapter.normalizeUrl(line) : line;
    const dupOf = seen.get(normalizedUrl);
    if (dupOf !== undefined) {
      rejected.push({ line: lineNo, text: line, reason: `Trùng với dòng ${dupOf}` });
      return;
    }
    seen.set(normalizedUrl, lineNo);
    links.push({ inputUrl: line, normalizedUrl, platform, supported: !!adapter });
  });
  return { links, rejected };
}

export function unsupportedReason(platform: Platform): string {
  return `${getPlatformLabel(platform)} chưa được hỗ trợ ở phiên bản này`;
}
