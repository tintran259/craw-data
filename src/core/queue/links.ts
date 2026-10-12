import { detectPlatform, findAdapterForUrl, getPlatformLabel } from '@/adapters/registry';
import type { Platform } from '@/adapters/types';
import { safeParseUrl } from '@/shared/url';

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
    if (!adapter && platform === 'facebook') {
      rejected.push({
        line: lineNo,
        text: line,
        reason: 'Không phải link bài viết Facebook (cần link /posts/, /reel/, /share/p/, ...)',
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
