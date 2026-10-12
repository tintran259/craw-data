import type { PlatformAdapter, PlatformInfo } from '@/adapters/types';
import { loadAllFacebookComments } from './actions';
import { detectFacebookBlock } from './block-detector';
import { parseFacebookInitialHtml } from './initial-html';
import { FACEBOOK_INTERCEPT_TARGETS } from './intercept-targets';
import { extractFacebookTotalCount, parseFacebookPayload } from './parser';
import { describeFacebookRequest, isFacebookGraphqlRequest } from './request';
import { safeParseUrl } from '@/shared/url';
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
  isTargetRequest: (url) => isFacebookGraphqlRequest(url),
  describeRequest: describeFacebookRequest,
  contentScriptMatches: ['https://*.facebook.com/*'],
  interceptTargets: FACEBOOK_INTERCEPT_TARGETS,
  parsePayload: parseFacebookPayload,
  parseInitialHtml: parseFacebookInitialHtml,
  extractTotalCount: extractFacebookTotalCount,
  loadAllComments: loadAllFacebookComments,
  detectBlock: detectFacebookBlock,
};
