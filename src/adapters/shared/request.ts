import { matchesInterceptTarget } from '@/adapters/intercept-targets';
import type { InterceptTarget, RequestInfo } from '@/adapters/types';
import { safeParseUrl } from '@/shared/url';

/** `isTargetRequest` của adapter: URL thuộc một trong các endpoint của nền tảng. */
export const targetMatcher =
  (targets: InterceptTarget[]) =>
  (url: string): boolean => {
    const parsed = safeParseUrl(url);
    return !!parsed && matchesInterceptTarget(parsed, targets);
  };

/**
 * Mô tả request GraphQL dạng form (Facebook / Instagram / Threads cùng nền Relay của Meta).
 * Body chứa cả token (`fb_dtsg`, `lsd`, `__user`...) — chỉ trích tên operation, doc_id, variables;
 * token không bao giờ rời khỏi trang. Endpoint REST (không body): lấy tên từ đường dẫn.
 */
export function describeFormGraphql(url: string, body?: string): RequestInfo {
  let params: URLSearchParams | null;
  try {
    params = body ? new URLSearchParams(body) : null;
  } catch {
    params = null;
  }
  return {
    operationName: params?.get('fb_api_req_friendly_name') ?? safeParseUrl(url)?.pathname ?? null,
    docId: params?.get('doc_id') ?? null,
    variables: params?.get('variables') ?? null,
  };
}
