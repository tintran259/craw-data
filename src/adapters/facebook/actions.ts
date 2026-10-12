import { BlockedError } from '@/adapters/errors';
import type { ActionContext } from '@/adapters/types';
import { AbortedError } from '@/shared/utils/delay';
import { detectFacebookBlock } from './block-detector';

/**
 * Tự động tải hết bình luận. Chỉ chọn element theo role / aria / nội dung text
 * (giao diện tiếng Việt và tiếng Anh), không dùng class name sinh tự động.
 */

const normalize = (s: string | null | undefined) =>
  (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Nút sắp xếp bình luận đang hiển thị lựa chọn hiện tại. */
const SORT_BUTTON =
  /^(most relevant|newest|top comments|all comments|phù hợp nhất|mới nhất|bình luận hàng đầu|tất cả bình luận)$/;
const ALL_COMMENTS = /^(all comments|tất cả bình luận)/;

const MORE_COMMENTS: RegExp[] = [
  /^(view|see) (more|previous|all) comments$/,
  /^(view|see) \d+ more comments?$/,
  /^xem thêm bình luận$/,
  /^xem (các )?bình luận trước( đó)?$/,
  /^xem( thêm)? \d+ bình luận( nữa| khác)?$/,
];

const MORE_REPLIES: RegExp[] = [
  /^(view|see) (all )?(\d+ )?(more |previous )?repl(y|ies)$/,
  /\breplied\b.*\brepl(y|ies)$/,
  /^xem (tất cả )?(thêm )?(\d+ )?(câu )?(phản hồi|trả lời)( khác| trước)?$/,
  /đã (trả lời|phản hồi) .*\d+ (phản hồi|trả lời)$/,
];

const MAX_CLICKS_PER_ELEMENT = 3;
const MAX_ACTIONS = 3000;

function isVisible(el: Element): boolean {
  return el.getClientRects().length > 0;
}

/** Vùng chứa bài viết: hộp thoại bài viết nếu đang mở, ngược lại là cả trang. */
function scope(): ParentNode {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
    (d) => isVisible(d) && d.querySelector('[role="article"]'),
  );
  return dialogs.at(-1) ?? document;
}

function buttons(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="button"], button')].filter(
    (el) => isVisible(el) && (el.textContent?.length ?? 0) < 120,
  );
}

function clickHuman(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
  el.click();
}

export async function loadAllFacebookComments(ctx: ActionContext): Promise<void> {
  const clicks = new WeakMap<Element, number>();
  const check = () => {
    if (ctx.signal.aborted) throw new AbortedError();
    const block = detectFacebookBlock(document);
    if (block) throw new BlockedError(block);
  };

  check();
  await openCommentSection(ctx);
  check();
  await switchToAllComments(ctx, check);

  const findNext = (): HTMLElement | null => {
    const candidates = buttons(scope()).filter(
      (el) => (clicks.get(el) ?? 0) < MAX_CLICKS_PER_ELEMENT,
    );
    const byText = (patterns: RegExp[]) =>
      candidates.find((el) => {
        const text = normalize(el.textContent);
        return patterns.some((re) => re.test(text));
      }) ?? null;
    return (ctx.includeReplies ? byText(MORE_REPLIES) : null) ?? byText(MORE_COMMENTS);
  };

  let actions = 0;
  let idleRounds = 0;
  while (actions < MAX_ACTIONS) {
    check();
    const next = findNext();
    if (next) {
      ctx.log(`Bấm "${normalize(next.textContent)}"`);
      clicks.set(next, (clicks.get(next) ?? 0) + 1);
      clickHuman(next);
      actions++;
      idleRounds = 0;
      await ctx.humanDelay();
      continue;
    }

    // Không còn nút: cuộn tới bình luận cuối để kích hoạt tải vô hạn (nếu có).
    const articles = scope().querySelectorAll('[role="article"]');
    const last = articles[articles.length - 1];
    if (last) last.scrollIntoView({ block: 'end', behavior: 'instant' as ScrollBehavior });
    else window.scrollBy(0, window.innerHeight);
    actions++;
    await ctx.humanDelay();

    const idleFor = Date.now() - ctx.lastPayloadAt();
    if (!findNext() && idleFor >= ctx.idleStopMs) {
      idleRounds++;
      // Xác nhận hai lần liên tiếp để tránh dừng sớm khi mạng chậm.
      if (idleRounds >= 2) {
        ctx.log('Không còn nút tải thêm và không có dữ liệu mới — hoàn tất.');
        return;
      }
    }
  }
  ctx.log('Đạt giới hạn số thao tác an toàn — dừng.');
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

async function switchToAllComments(ctx: ActionContext, check: () => void): Promise<void> {
  const sortButton = buttons(scope()).find((el) => SORT_BUTTON.test(normalize(el.textContent)));
  if (!sortButton) {
    ctx.log('Không thấy nút sắp xếp bình luận — giữ nguyên.');
    return;
  }
  if (ALL_COMMENTS.test(normalize(sortButton.textContent))) return;

  clickHuman(sortButton);
  await ctx.humanDelay();
  check();
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]'),
  ].find((el) => isVisible(el) && ALL_COMMENTS.test(normalize(el.textContent)));
  if (item) {
    ctx.log('Chuyển bộ lọc sang "Tất cả bình luận".');
    item.click();
    await ctx.humanDelay();
  } else {
    ctx.log('Không thấy mục "Tất cả bình luận" — giữ bộ lọc hiện tại.');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
}
