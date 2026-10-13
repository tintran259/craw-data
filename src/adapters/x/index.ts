import type { BlockReason, PlatformAdapter, PlatformInfo } from '@/adapters/types';
import { loadMoreComments } from '@/adapters/shared/load-more';
import { targetMatcher } from '@/adapters/shared/request';
import { safeParseUrl } from '@/shared/url';
import { X_INTERCEPT_TARGETS } from './intercept-targets';
import { extractXTotalCount, parseXPayload } from './parser';
import { isXHost, matchXPostUrl, normalizeXUrl } from './url';

export const xInfo: PlatformInfo = {
  id: 'x',
  label: 'X',
  matchUrl: (url) => {
    const parsed = safeParseUrl(url);
    return !!parsed && isXHost(parsed.hostname);
  },
};

export function detectXBlock(doc: Document): BlockReason | null {
  const path = doc.location?.pathname ?? '';
  if (path.startsWith('/account/access')) {
    return {
      code: 'checkpoint',
      message: 'X yêu cầu xác minh tài khoản. Hãy xử lý trong cửa sổ thu thập rồi bấm Tiếp tục.',
    };
  }
  if (path.startsWith('/i/flow/login') || path === '/login') {
    return {
      code: 'login_required',
      message: 'X yêu cầu đăng nhập. Hãy đăng nhập X trên Chrome rồi bấm Tiếp tục.',
    };
  }
  const text = (doc.querySelector('main')?.textContent ?? '').slice(0, 3000);
  if (/rate limit exceeded|vượt quá giới hạn/i.test(text)) {
    return {
      code: 'rate_limited',
      message:
        'X báo vượt giới hạn truy cập. Đã dừng hàng đợi — hãy nghỉ một thời gian rồi chạy lại.',
    };
  }
  if (
    !doc.querySelector('article') &&
    /this post is unavailable|this page doesn[’']t exist|bài đăng này không khả dụng|trang này không tồn tại/i.test(
      text,
    )
  ) {
    return {
      code: 'unavailable',
      message: 'Bài viết không tồn tại, đã bị xóa hoặc tài khoản của bạn không có quyền xem.',
    };
  }
  return null;
}

export const xAdapter: PlatformAdapter = {
  id: 'x',
  matchUrl: matchXPostUrl,
  normalizeUrl: normalizeXUrl,
  isTargetRequest: targetMatcher(X_INTERCEPT_TARGETS),
  // GET /i/api/graphql/{queryId}/{Operation}: biến nằm trong query (interceptor đã bỏ query).
  describeRequest: (url) => {
    const name = safeParseUrl(url)?.pathname.split('/').filter(Boolean).at(-1) ?? null;
    return { operationName: name, docId: null, variables: null };
  },
  contentScriptMatches: ['https://x.com/*', 'https://*.x.com/*', 'https://*.twitter.com/*'],
  supportsFastMode: false,
  parsePayload: parseXPayload,
  // X không nhúng hội thoại vào HTML; mọi thứ đến từ TweetDetail.
  parseInitialHtml: () => [],
  extractTotalCount: extractXTotalCount,
  loadAllComments: (ctx) =>
    loadMoreComments(ctx, {
      moreComments: [
        /^show more replies$/,
        /^show (additional|probable spam)/,
        /^(hiển thị|hiện|xem) thêm (các )?(câu )?(trả lời|phản hồi)/,
      ],
      moreReplies: [/^show replies$/, /^(hiển thị|hiện|xem) (các )?(câu )?(trả lời|phản hồi)$/],
      detectBlock: detectXBlock,
      // Hội thoại X tải vô hạn khi cuộn và đôi khi chậm: chờ thêm vài vòng trước khi dừng.
      idleRoundsToStop: 4,
    }),
  detectBlock: detectXBlock,
};
