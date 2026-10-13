import type { ActionContext } from '@/adapters/types';
import { attachFastMode } from '@/adapters/shared/fast-mode';
import {
  clickHuman,
  isVisible,
  loadMoreComments,
  normalizeText,
} from '@/adapters/shared/load-more';
import { formatDisplayTime } from '@/shared/utils/time';
import { detectFacebookBlock } from './block-detector';
import { FacebookCommentPager } from './graphql-pager';

/**
 * Tự động tải hết bình luận Facebook. Chế độ nhanh: khi đã có đủ thông tin, gọi thẳng API phân
 * trang (graphql-pager + api-runner); bấm nút (vòng lặp dùng chung) chỉ còn là phương án dự phòng
 * cho loại trang API chưa lo được.
 */

/** Nút sắp xếp bình luận đang hiển thị lựa chọn hiện tại. */
const SORT_BUTTON =
  /^(most relevant|newest|top comments|all comments|phù hợp nhất|mới nhất|bình luận hàng đầu|tất cả bình luận)$/;
type SortTarget = 'all' | 'newest';
const SORT_TARGET: Record<SortTarget, { label: string; re: RegExp }> = {
  all: { label: 'Tất cả bình luận', re: /^(all comments|tất cả bình luận)/ },
  newest: { label: 'Mới nhất', re: /^(newest|mới nhất)/ },
};

/** Số đếm Facebook hiển thị: `12`, `4,381`, `4.381`, `1,2k`, `2k`, `1.5m`. */
const N = String.raw`\d[\d.,]*\s?[kmn]?`;

const MORE_COMMENTS: RegExp[] = [
  /^(view|see) (more|previous|all) comments$/,
  new RegExp(`^(view|see) (all )?${N} (more |previous )?comments?$`),
  /^xem thêm bình luận( khác)?$/,
  /^xem (các )?bình luận trước( đó)?$/,
  new RegExp(`^xem( thêm| tất cả)? ${N} bình luận( nữa| khác| trước)?$`),
];

const MORE_REPLIES: RegExp[] = [
  new RegExp(`^(view|see) (all )?(${N} )?(more |previous )?repl(y|ies)$`),
  /\breplied\b.*\brepl(y|ies)$/,
  new RegExp(`^xem (tất cả )?(thêm )?(${N} )?(câu )?(phản hồi|trả lời)( khác| trước)?$`),
  new RegExp(`đã (trả lời|phản hồi) .*${N} (phản hồi|trả lời)$`),
];

/** Nút có số đếm và nhắc tới bình luận/phản hồi nhưng không khớp mẫu nào — để chẩn đoán. */
const LOOKS_LIKE_LOAD_MORE = /\d.*(bình luận|phản hồi|trả lời|comment|repl)/;

/** Khi chưa đúng bộ lọc: cứ mỗi bấy nhiêu thao tác thì thử chuyển lại, tối đa vài lần. */
const SORT_RETRY_EVERY = 10;
const MAX_SORT_RETRIES = 3;

/** Vùng chứa bài viết: hộp thoại bài viết nếu đang mở, ngược lại là cả trang. */
function scope(): ParentNode {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
    (d) => isVisible(d) && d.querySelector('[role="article"]'),
  );
  return dialogs.at(-1) ?? document;
}

/** Cuộn tới bình luận cuối để kích hoạt tải vô hạn (nếu có). */
function scrollToLastComment(): void {
  const articles = scope().querySelectorAll('[role="article"]');
  const last = articles[articles.length - 1];
  if (last) last.scrollIntoView({ block: 'end', behavior: 'instant' as ScrollBehavior });
  else window.scrollBy(0, window.innerHeight);
}

/** Trả về ghi chú cho người dùng: đã tải bằng cách nào, bao nhiêu, và vì sao dừng. */
export async function loadAllFacebookComments(ctx: ActionContext): Promise<string> {
  const pager = ctx.graphql
    ? new FacebookCommentPager({
        replyDepth: ctx.replyDepth,
        onlyNewerThan: ctx.onlyNewerThan,
        probeFeedLocation: ctx.graphql.probeFeedLocation,
      })
    : null;
  const fast = attachFastMode(ctx, pager, {
    htmlMarkers: ['"Comment"'],
    detectBlock: detectFacebookBlock,
  });
  try {
    await openCommentSection(ctx);
    const target: SortTarget = ctx.onlyNewerThan === null ? 'all' : 'newest';
    const listsBefore = pager?.pageRootListsSeen() ?? 0;
    let sort = await ensureSort(ctx, target);
    let sortRetries = 0;
    // Vừa đổi bộ lọc: chờ Facebook trả danh sách mới trước khi gọi API — cursor của bộ lọc cũ
    // không dùng tiếp được, và gọi sớm sẽ chạy song song hai chuỗi khác nhau.
    if (pager && sort.switched) {
      await waitFor(ctx, 5, () => (pager.pageRootListsSeen() > listsBefore ? true : null));
    }

    return await loadMoreComments(ctx, {
      moreComments: MORE_COMMENTS,
      moreReplies: MORE_REPLIES,
      detectBlock: detectFacebookBlock,
      scope,
      scroll: scrollToLastComment,
      looksLikeLoadMore: LOOKS_LIKE_LOAD_MORE,
      ...fast.loop,
      notePrefix: () => [
        ...(ctx.onlyNewerThan !== null
          ? [
              `Chỉ lấy bình luận mới hơn lần chạy trước (${formatDisplayTime(new Date(ctx.onlyNewerThan * 1000).toISOString())}).`,
            ]
          : []),
        describeSort(sort),
        ...fast.lines(),
      ],
      step: async (actions) => {
        // Chưa chắc đúng bộ lọc (nút sắp xếp hiện muộn / đổi chưa được): thử lại định kỳ.
        // Đổi giữa chừng thì Facebook tải lại danh sách — bản ghi trùng được khử theo commentId.
        if (
          sort.state !== 'ok' &&
          sortRetries < MAX_SORT_RETRIES &&
          actions > 0 &&
          actions % SORT_RETRY_EVERY === 0
        ) {
          sortRetries++;
          sort = await ensureSort(ctx, target, 0);
        }
        return fast.loop.step!(actions);
      },
    });
  } finally {
    fast.dispose();
  }
}

/** Nút mở khung bình luận (Reel/Video ẩn bình luận cho tới khi bấm). */
const COMMENT_TOGGLE = /^(comment|comments|leave a comment|bình luận|viết bình luận)$/i;

async function openCommentSection(ctx: ActionContext): Promise<void> {
  if (scope().querySelector('[role="article"]')) return;
  const toggle = [...document.querySelectorAll<HTMLElement>('[role="button"][aria-label]')].find(
    (el) => isVisible(el) && COMMENT_TOGGLE.test((el.getAttribute('aria-label') ?? '').trim()),
  );
  if (!toggle) return;
  ctx.log('Mở khung bình luận.');
  clickHuman(toggle);
  await ctx.humanDelay();
}

interface SortResult {
  /** ok: đã đúng bộ lọc; not-found: không thấy nút sắp xếp; failed: không đổi được. */
  state: 'ok' | 'not-found' | 'failed';
  target: SortTarget;
  /** Đã bấm đổi bộ lọc (trang sẽ tải lại danh sách). */
  switched: boolean;
  /** Bộ lọc đang hiển thị (vd. "phù hợp nhất") khi không đổi được. */
  current: string | null;
}

const findSortButton = () =>
  [...scope().querySelectorAll<HTMLElement>('[role="button"], button')].find(
    (el) =>
      (el.textContent?.length ?? 0) < 120 &&
      SORT_BUTTON.test(normalizeText(el.textContent)) &&
      isVisible(el),
  ) ?? null;

/** Lặp `humanDelay` tối đa `rounds` lần cho tới khi `find` trả về giá trị. */
async function waitFor<T>(
  ctx: ActionContext,
  rounds: number,
  find: () => T | null,
): Promise<T | null> {
  let found = find();
  for (let i = 0; !found && i < rounds; i++) {
    await ctx.humanDelay();
    found = find();
  }
  return found;
}

/** Số vòng chờ nút sắp xếp xuất hiện (khung bình luận của video/reel hiện chậm). */
const SORT_BUTTON_WAIT_ROUNDS = 3;
const SORT_SWITCH_ATTEMPTS = 2;

/**
 * Đảm bảo bộ lọc bình luận là `target` ("Tất cả bình luận", hoặc "Mới nhất" khi chỉ lấy bình luận
 * mới): chờ nút sắp xếp xuất hiện, chọn mục trong menu, rồi KIỂM TRA LẠI nhãn của nút; thử lại
 * nếu Facebook chưa đổi.
 */
async function ensureSort(
  ctx: ActionContext,
  target: SortTarget,
  waitRounds = SORT_BUTTON_WAIT_ROUNDS,
): Promise<SortResult> {
  const { label, re } = SORT_TARGET[target];
  const isTarget = (el: Element) => re.test(normalizeText(el.textContent));
  let sortButton = await waitFor(ctx, waitRounds, findSortButton);
  if (!sortButton) return { state: 'not-found', target, current: null, switched: false };
  if (isTarget(sortButton)) return { state: 'ok', target, current: null, switched: false };

  for (let attempt = 0; attempt < SORT_SWITCH_ATTEMPTS && sortButton; attempt++) {
    ctx.log(`Bộ lọc đang là "${normalizeText(sortButton.textContent)}" — chuyển sang "${label}".`);
    clickHuman(sortButton);
    const item = await waitFor(
      ctx,
      3,
      () =>
        [
          ...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]'),
        ].find((el) => isVisible(el) && isTarget(el)) ?? null,
    );
    if (!item) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await ctx.humanDelay();
      sortButton = findSortButton();
      continue;
    }
    item.click();
    const switched = await waitFor(ctx, 3, () => {
      const b = findSortButton();
      return b && isTarget(b) ? b : null;
    });
    if (switched) {
      ctx.log(`Đã chuyển sang "${label}".`);
      return { state: 'ok', target, current: null, switched: true };
    }
    sortButton = findSortButton();
  }
  return {
    state: 'failed',
    target,
    current: sortButton ? normalizeText(sortButton.textContent) : null,
    switched: false,
  };
}

/** Ghi chú về bộ lọc cho người dùng. */
function describeSort(sort: SortResult): string {
  const label = SORT_TARGET[sort.target].label;
  if (sort.state === 'ok') return `Bộ lọc: "${label}".`;
  if (sort.state === 'not-found') {
    return `Không thấy nút sắp xếp bình luận nên không kiểm tra được bộ lọc — nếu bài không ở "${label}" thì có thể thiếu bình luận.`;
  }
  return `Không chuyển được sang "${label}" (bộ lọc vẫn là "${sort.current ?? 'không rõ'}") — có thể thiếu bình luận.`;
}
