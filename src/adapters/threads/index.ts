import type { ActionContext, BlockReason, PlatformAdapter, PlatformInfo } from '@/adapters/types';
import { attachFastMode } from '@/adapters/shared/fast-mode';
import { htmlJsonBlocks } from '@/adapters/shared/html-json';
import { loadMoreComments } from '@/adapters/shared/load-more';
import { describeFormGraphql, targetMatcher } from '@/adapters/shared/request';
import { safeParseUrl } from '@/shared/url';
import { ThreadsCommentPager } from './graphql-pager';
import { THREADS_INTERCEPT_TARGETS } from './intercept-targets';
import { extractThreadsTotalCount, parseThreadsPayload } from './parser';
import { isThreadsHost, matchThreadsPostUrl, normalizeThreadsUrl, threadsPostCode } from './url';

export const threadsInfo: PlatformInfo = {
  id: 'threads',
  label: 'Threads',
  matchUrl: (url) => {
    const parsed = safeParseUrl(url);
    return !!parsed && isThreadsHost(parsed.hostname);
  },
};

export function detectThreadsBlock(doc: Document): BlockReason | null {
  const path = doc.location?.pathname ?? '';
  if (path.startsWith('/login')) {
    return {
      code: 'login_required',
      message: 'Threads yêu cầu đăng nhập. Hãy đăng nhập Threads trên Chrome rồi bấm Tiếp tục.',
    };
  }
  const text = (doc.body?.textContent ?? '').slice(0, 5000);
  if (/please wait a few minutes|try again later|vui lòng thử lại sau/i.test(text)) {
    return {
      code: 'rate_limited',
      message:
        'Threads báo thao tác quá nhanh. Đã dừng hàng đợi — hãy nghỉ một thời gian rồi tăng độ trễ.',
    };
  }
  if (/sorry, this page isn['’]t available|rất tiếc, trang này hiện không khả dụng/i.test(text)) {
    return {
      code: 'unavailable',
      message: 'Bài viết không tồn tại, đã bị xóa hoặc tài khoản của bạn không có quyền xem.',
    };
  }
  return null;
}

const MORE_COMMENTS = [
  /^(view|show|see) more (replies|comments)$/,
  /^xem thêm (câu trả lời|bình luận)$/,
];
const MORE_REPLIES = [
  /^(view|show|see) (all )?([d.,]+ )?(more )?repl(y|ies)$/,
  /^xem (tất cả )?(thêm )?([d.,]+ )?(câu )?(trả lời|phản hồi)$/,
];

/**
 * Chế độ nhanh (API GraphQL của trang) khi bật. Threads không nhúng biến request trong HTML:
 * trang phải tự tải ít nhất một lần (khi cuộn) thì chế độ nhanh mới học được biến và tiếp quản.
 */
async function loadAllThreadsComments(ctx: ActionContext): Promise<string> {
  // URL trang hiện tại: link chia sẻ (/share/...) đã được chuyển sang link bài thật.
  const postCode = threadsPostCode(location.href);
  const pager = ctx.graphql
    ? new ThreadsCommentPager({ replyDepth: ctx.replyDepth, postCode })
    : null;
  const fast = attachFastMode(ctx, pager, {
    htmlMarkers: ['direct_replies', postCode && `"${postCode}"`],
    detectBlock: detectThreadsBlock,
  });
  try {
    // Threads tải reply khi cuộn; nút chỉ xuất hiện ở một số nhánh dài.
    return await loadMoreComments(ctx, {
      moreComments: MORE_COMMENTS,
      moreReplies: MORE_REPLIES,
      detectBlock: detectThreadsBlock,
      idleRoundsToStop: 3,
      ...fast.loop,
      notePrefix: fast.lines,
    });
  } finally {
    fast.dispose();
  }
}

export const threadsAdapter: PlatformAdapter = {
  id: 'threads',
  matchUrl: matchThreadsPostUrl,
  normalizeUrl: normalizeThreadsUrl,
  isTargetRequest: targetMatcher(THREADS_INTERCEPT_TARGETS),
  describeRequest: describeFormGraphql,
  contentScriptMatches: ['https://*.threads.com/*', 'https://*.threads.net/*'],
  supportsFastMode: true,
  parsePayload: parseThreadsPayload,
  parseInitialHtml: (doc, ctx) =>
    htmlJsonBlocks(doc, '"taken_at"').flatMap((raw) => parseThreadsPayload(raw, ctx)),
  extractTotalCount: extractThreadsTotalCount,
  loadAllComments: loadAllThreadsComments,
  detectBlock: detectThreadsBlock,
};
