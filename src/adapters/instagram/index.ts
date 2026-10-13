import type { ActionContext, BlockReason, PlatformAdapter, PlatformInfo } from '@/adapters/types';
import { attachFastMode } from '@/adapters/shared/fast-mode';
import { htmlJsonBlocks } from '@/adapters/shared/html-json';
import { loadMoreComments } from '@/adapters/shared/load-more';
import { describeFormGraphql, targetMatcher } from '@/adapters/shared/request';
import { safeParseUrl } from '@/shared/url';
import { InstagramCommentPager } from './graphql-pager';
import { INSTAGRAM_INTERCEPT_TARGETS } from './intercept-targets';
import { extractInstagramTotalCount, parseInstagramPayload } from './parser';
import {
  instagramShortcode,
  isInstagramHost,
  matchInstagramPostUrl,
  normalizeInstagramUrl,
} from './url';

export const instagramInfo: PlatformInfo = {
  id: 'instagram',
  label: 'Instagram',
  matchUrl: (url) => {
    const parsed = safeParseUrl(url);
    return !!parsed && isInstagramHost(parsed.hostname);
  },
};

export function detectInstagramBlock(doc: Document): BlockReason | null {
  const path = doc.location?.pathname ?? '';
  if (path.startsWith('/challenge')) {
    return {
      code: 'checkpoint',
      message:
        'Instagram yêu cầu xác minh tài khoản. Hãy xử lý trong cửa sổ thu thập rồi bấm Tiếp tục.',
    };
  }
  if (path.startsWith('/accounts/login')) {
    return {
      code: 'login_required',
      message: 'Instagram yêu cầu đăng nhập. Hãy đăng nhập Instagram trên Chrome rồi bấm Tiếp tục.',
    };
  }
  const text = (doc.body?.textContent ?? '').slice(0, 5000);
  if (/please wait a few minutes before you try again|vui lòng chờ vài phút/i.test(text)) {
    return {
      code: 'rate_limited',
      message:
        'Instagram báo thao tác quá nhanh. Đã dừng hàng đợi — hãy nghỉ một thời gian rồi tăng độ trễ.',
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
  /^(load|view|see) more comments$/,
  /^(tải|xem) thêm bình luận$/,
  /^(view|xem) (all|tất cả) [d.,]+s?[km]? (comments|bình luận)$/,
];
const MORE_REPLIES = [
  /^(—s*)?(view|see) (all )?([d.,]+ )?(more )?repl(y|ies)( ([d.,]+))?$/,
  /^(—s*)?xem (tất cả )?(thêm )?([d.,]+ )?(câu )?(trả lời|phản hồi)( ([d.,]+))?$/,
];

/** Chế độ nhanh (API GraphQL của trang) khi bật; bấm nút / cuộn là phương án dự phòng. */
async function loadAllInstagramComments(ctx: ActionContext): Promise<string> {
  // URL trang hiện tại: link chia sẻ (/share/...) đã được chuyển sang link bài thật.
  const postCode = instagramShortcode(location.href);
  const pager = ctx.graphql
    ? new InstagramCommentPager({ replyDepth: ctx.replyDepth, postCode })
    : null;
  const fast = attachFastMode(ctx, pager, {
    htmlMarkers: ['XDTCommentDict', postCode && `"${postCode}"`],
    detectBlock: detectInstagramBlock,
  });
  try {
    return await loadMoreComments(ctx, {
      moreComments: MORE_COMMENTS,
      moreReplies: MORE_REPLIES,
      detectBlock: detectInstagramBlock,
      ...fast.loop,
      notePrefix: fast.lines,
    });
  } finally {
    fast.dispose();
  }
}

export const instagramAdapter: PlatformAdapter = {
  id: 'instagram',
  matchUrl: matchInstagramPostUrl,
  normalizeUrl: normalizeInstagramUrl,
  isTargetRequest: targetMatcher(INSTAGRAM_INTERCEPT_TARGETS),
  describeRequest: describeFormGraphql,
  contentScriptMatches: ['https://*.instagram.com/*'],
  supportsFastMode: true,
  parsePayload: parseInstagramPayload,
  parseInitialHtml: (doc, ctx) =>
    htmlJsonBlocks(doc, '"username"').flatMap((raw) => parseInstagramPayload(raw, ctx)),
  extractTotalCount: extractInstagramTotalCount,
  loadAllComments: loadAllInstagramComments,
  detectBlock: detectInstagramBlock,
};
