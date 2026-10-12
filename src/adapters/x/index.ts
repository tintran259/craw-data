import type { PlatformInfo } from '@/adapters/types';
import { hostMatches, safeParseUrl } from '@/shared/url';

// TODO(giai đoạn sau): implement PlatformAdapter cho X rồi đăng ký trong adapters/registry.ts.
// Hiện chỉ nhận diện link để side panel hiển thị badge và đánh dấu "chưa hỗ trợ".
const HOSTS = ['x.com', 'twitter.com'];

export const xInfo: PlatformInfo = {
  id: 'x',
  label: 'X',
  matchUrl: (url) => {
    const parsed = safeParseUrl(url);
    return !!parsed && HOSTS.some((h) => hostMatches(parsed.hostname, h));
  },
};
