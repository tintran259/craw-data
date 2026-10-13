import type { PlatformAdapter, PlatformInfo } from '@/adapters/types';
import { htmlJsonBlocks } from '@/adapters/shared/html-json';
import { describeFormGraphql, targetMatcher } from '@/adapters/shared/request';
import { safeParseUrl } from '@/shared/url';
import { loadAllFacebookComments } from './actions';
import { detectFacebookBlock } from './block-detector';
import { FACEBOOK_INTERCEPT_TARGETS } from './intercept-targets';
import { extractFacebookTotalCount, parseFacebookPayload } from './parser';
import { isFacebookHost, matchFacebookPostUrl, normalizeFacebookUrl } from './url';

export const facebookInfo: PlatformInfo = {
  id: 'facebook',
  label: 'Facebook',
  /** Mọi link Facebook (để hiện badge); adapter mới kiểm tra có phải link bài viết hay không. */
  matchUrl: (url) => {
    const parsed = safeParseUrl(url);
    return !!parsed && isFacebookHost(parsed.hostname);
  },
};

export const facebookAdapter: PlatformAdapter = {
  id: 'facebook',
  matchUrl: matchFacebookPostUrl,
  normalizeUrl: normalizeFacebookUrl,
  isTargetRequest: targetMatcher(FACEBOOK_INTERCEPT_TARGETS),
  describeRequest: describeFormGraphql,
  contentScriptMatches: ['https://*.facebook.com/*'],
  supportsFastMode: true,
  parsePayload: parseFacebookPayload,
  // Lô comment đầu tiên nằm trong các thẻ <script type="application/json"> của HTML.
  parseInitialHtml: (doc, ctx) =>
    htmlJsonBlocks(doc, '"Comment"').flatMap((raw) => parseFacebookPayload(raw, ctx)),
  extractTotalCount: extractFacebookTotalCount,
  loadAllComments: loadAllFacebookComments,
  detectBlock: detectFacebookBlock,
};
