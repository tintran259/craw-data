import type { RequestInfo } from '@/adapters/types';
import { safeParseUrl } from '@/shared/url';
import { FACEBOOK_INTERCEPT_TARGETS } from './intercept-targets';
import { isFacebookHost } from './url';

export function isFacebookGraphqlRequest(url: string): boolean {
  const parsed = safeParseUrl(url);
  if (!parsed || !isFacebookHost(parsed.hostname)) return false;
  return FACEBOOK_INTERCEPT_TARGETS.some((t) =>
    t.pathPrefixes.some((p) => parsed.pathname.startsWith(p)),
  );
}

/**
 * Body GraphQL của Facebook là form-urlencoded, gồm cả token (`fb_dtsg`, `lsd`, `__user`...).
 * Chỉ trích ra các trường mô tả operation; token không bao giờ rời khỏi trang.
 */
export function describeFacebookRequest(_url: string, body?: string): RequestInfo {
  if (!body) return { operationName: null, docId: null, variables: null };
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(body);
  } catch {
    return { operationName: null, docId: null, variables: null };
  }
  return {
    operationName: params.get('fb_api_req_friendly_name'),
    docId: params.get('doc_id'),
    variables: params.get('variables'),
  };
}
