import type { PlatformInfo } from '@/adapters/types';
import { hostMatches, safeParseUrl } from '@/shared/url';

// TODO(giai đoạn sau): implement PlatformAdapter cho TikTok rồi đăng ký trong adapters/registry.ts.
// Hiện chỉ nhận diện link để side panel hiển thị badge và đánh dấu "chưa hỗ trợ".
const HOSTS = ['tiktok.com'];

export const tiktokInfo: PlatformInfo = {
  id: 'tiktok',
  label: 'TikTok',
  matchUrl: (url) => {
    const parsed = safeParseUrl(url);
    return !!parsed && HOSTS.some((h) => hostMatches(parsed.hostname, h));
  },
};
