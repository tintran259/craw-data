import { BlockedError } from '@/adapters/errors';
import type { ActionContext, BlockReason } from '@/adapters/types';
import { AbortedError } from '@/shared/utils/delay';

/**
 * Vòng lặp tải bình luận dùng chung cho mọi nền tảng: bấm nút "xem thêm" nếu có (bình luận gốc
 * trước, reply sau), nếu không thì cuộn để kích hoạt tải vô hạn. Dừng khi không còn nút và không
 * có dữ liệu mới trong `idleStopMs`. Chỉ chọn element theo role / aria-label / nội dung text,
 * không dùng class name sinh tự động.
 */

export interface LoadMoreConfig {
  /** Nút tải thêm bình luận gốc (so với text hoặc aria-label đã chuẩn hóa, chữ thường). */
  moreComments: RegExp[];
  /** Nút mở / tải thêm reply. */
  moreReplies: RegExp[];
  detectBlock(doc: Document): BlockReason | null;
  /** Số vòng cuộn liên tiếp không có dữ liệu mới trước khi dừng (tải vô hạn cần nhiều hơn). */
  idleRoundsToStop?: number;
  /** Vùng tìm nút (vd. hộp thoại bài viết). Mặc định: cả trang. */
  scope?: () => ParentNode;
  /** Cuộn để tải thêm. Mặc định: cuộn trang và mọi khung có thanh cuộn xuống cuối. */
  scroll?: () => void;
  /**
   * Việc riêng của nền tảng chạy đầu mỗi vòng (vd. gọi API, thử đổi bộ lọc):
   * `worked` = đã làm được việc (vòng sau chạy lại), `done` = đã tải hết, `idle` = không có việc.
   */
  step?: (actions: number) => Promise<'worked' | 'done' | 'idle'>;
  /** Có được bấm nút gốc / reply không (vd. API đã lo thì không bấm, tránh tải trùng). */
  allowComments?: () => boolean;
  allowReplies?: () => boolean;
  /** Các dòng ghi chú đặt trước phần thống kê bấm nút (bộ lọc, chế độ nhanh...). */
  notePrefix?: () => string[];
  /** Nút trông giống "xem thêm" nhưng không khớp mẫu nào — để chẩn đoán. */
  looksLikeLoadMore?: RegExp;
}

/** Lưới an toàn chống vòng lặp vô hạn; timeout mỗi bài mới là giới hạn chính. */
const MAX_ACTIONS = 20_000;
/**
 * Số lần bấm liên tiếp KHÔNG có dữ liệu mới trên cùng một nút trước khi bỏ qua nó. Nền tảng
 * thường giữ nguyên element "Xem thêm" qua nhiều trang, nên chỉ đếm những lần bấm không tải thêm
 * được gì — bài nhiều bình luận cần bấm cùng nút hàng chục lần.
 */
const MAX_IDLE_CLICKS_PER_ELEMENT = 3;

export const normalizeText = (s: string | null | undefined) =>
  (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export const isVisible = (el: Element) => el.getClientRects().length > 0;

export function clickHuman(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
  el.click();
}

/** Nhãn của nút: text, hoặc aria-label của chính nó / icon bên trong (nút chỉ có icon). */
function labelOf(el: Element): string {
  const text = normalizeText(el.textContent);
  if (text) return text;
  const aria =
    el.getAttribute('aria-label') ??
    el.querySelector('[aria-label]')?.getAttribute('aria-label') ??
    el.querySelector('title')?.textContent;
  return normalizeText(aria);
}

/**
 * Nút có nhãn khớp mẫu, theo thứ tự trong trang. Lọc theo nhãn TRƯỚC rồi mới kiểm tra hiển thị:
 * bài hàng chục nghìn bình luận có rất nhiều nút, `getClientRects` trên từng nút rất chậm.
 */
function* matchingButtons(
  root: ParentNode,
  patterns: RegExp[],
): Generator<{ el: HTMLElement; label: string }> {
  if (!patterns.length) return;
  for (const el of root.querySelectorAll<HTMLElement>('[role="button"], button')) {
    if ((el.textContent?.length ?? 0) >= 120) continue;
    const label = labelOf(el);
    if (label && patterns.some((re) => re.test(label)) && isVisible(el)) yield { el, label };
  }
}

/** Quét lại danh sách khung cuộn sau bấy nhiêu lần cuộn (quét cả trang buộc tính lại layout). */
const RESCAN_SCROLLABLES_EVERY = 10;

/**
 * Cuộn trang và mọi khung có thanh cuộn xuống cuối (Instagram đặt bình luận trong khung riêng).
 * Danh sách khung cuộn được nhớ lại giữa các lần cuộn để không phải quét cả trang mỗi lần.
 */
function createDefaultScroll(): () => void {
  let scrollables: HTMLElement[] = [];
  let calls = 0;
  return () => {
    const page = document.scrollingElement ?? document.documentElement;
    window.scrollTo({ top: page.scrollHeight, behavior: 'instant' as ScrollBehavior });
    if (calls++ % RESCAN_SCROLLABLES_EVERY === 0) {
      scrollables = [...document.querySelectorAll<HTMLElement>('div, section, ul')].filter(
        (el) =>
          el.scrollHeight > el.clientHeight + 40 &&
          ['auto', 'scroll'].includes(getComputedStyle(el).overflowY),
      );
    }
    for (const el of scrollables) if (el.isConnected) el.scrollTop = el.scrollHeight;
  };
}

const quote = (texts: Iterable<string>) => [...texts].map((t) => `"${t}"`).join(', ');

export async function loadMoreComments(ctx: ActionContext, cfg: LoadMoreConfig): Promise<string> {
  const idleRoundsToStop = cfg.idleRoundsToStop ?? 2;
  const scope = cfg.scope ?? (() => document);
  const scroll = cfg.scroll ?? createDefaultScroll();
  const clicks = new WeakMap<Element, { count: number; payloadAt: number }>();
  const progressed = (s: { payloadAt: number }) => ctx.lastPayloadAt() > s.payloadAt;
  const canClick = (el: Element) => {
    const s = clicks.get(el);
    return !s || s.count < MAX_IDLE_CLICKS_PER_ELEMENT || progressed(s);
  };
  const check = () => {
    if (ctx.signal.aborted) throw new AbortedError();
    const block = cfg.detectBlock(document);
    if (block) throw new BlockedError(block);
  };
  const commentPatterns = () => ((cfg.allowComments?.() ?? true) ? cfg.moreComments : []);
  const replyPatterns = () =>
    ctx.replyDepth > 0 && (cfg.allowReplies?.() ?? true) ? cfg.moreReplies : [];
  /** Bình luận gốc trước: mở reply trước khiến bài lớn tốn gần hết thời gian vào vài nhánh. */
  const findNext = () => {
    const root = scope();
    for (const [patterns, reply] of [
      [commentPatterns(), false],
      [replyPatterns(), true],
    ] as const) {
      for (const b of matchingButtons(root, patterns)) if (canClick(b.el)) return { ...b, reply };
    }
    return null;
  };

  let commentClicks = 0;
  let replyClicks = 0;
  let scrolls = 0;
  const finish = (reason: string) => {
    const root = scope();
    const parts = [...(cfg.notePrefix?.() ?? [])];
    parts.push(
      `${reason} Đã bấm ${commentClicks} lần "xem thêm bình luận", ${replyClicks} lần "xem phản hồi", cuộn ${scrolls} lần.`,
    );
    const stalled = new Set<string>();
    for (const b of matchingButtons(root, [...commentPatterns(), ...replyPatterns()])) {
      if (!canClick(b.el)) stalled.add(b.label);
    }
    if (stalled.size) {
      parts.push(
        `Không có dữ liệu mới khi bấm ${quote([...stalled].slice(0, 3))} — có thể đang bị giới hạn tạm thời; nghỉ một lúc rồi chạy lại bài này.`,
      );
    }
    if (cfg.looksLikeLoadMore) {
      const known = [...cfg.moreComments, ...cfg.moreReplies];
      const unknown = new Set<string>();
      for (const el of root.querySelectorAll<HTMLElement>('[role="button"], button')) {
        const text = normalizeText(el.textContent);
        if (text.length > 80 || !cfg.looksLikeLoadMore.test(text)) continue;
        if (known.some((re) => re.test(text)) || !isVisible(el)) continue;
        unknown.add(text);
        if (unknown.size >= 3) break;
      }
      if (unknown.size) parts.push(`Nút chưa nhận diện: ${quote(unknown)}.`);
    }
    const note = parts.join('\n');
    ctx.log(note);
    return note;
  };

  let actions = 0;
  let idleRounds = 0;
  while (actions < MAX_ACTIONS) {
    check();
    const stepped = (await cfg.step?.(actions)) ?? 'idle';
    if (stepped === 'done') return finish('Đã tải hết.');
    if (stepped === 'worked') {
      actions++;
      idleRounds = 0;
      continue;
    }

    const next = findNext();
    if (next) {
      ctx.log(`Bấm "${next.label}"`);
      const s = clicks.get(next.el);
      clicks.set(next.el, {
        count: !s || progressed(s) ? 1 : s.count + 1,
        payloadAt: ctx.lastPayloadAt(),
      });
      clickHuman(next.el);
      if (next.reply) replyClicks++;
      else commentClicks++;
      actions++;
      idleRounds = 0;
      await ctx.afterClick();
      continue;
    }

    const before = ctx.lastPayloadAt();
    scroll();
    scrolls++;
    actions++;
    await ctx.afterClick(); // chờ dữ liệu (tối đa bằng độ trễ thao tác) như sau một lần bấm
    if (ctx.lastPayloadAt() > before) {
      idleRounds = 0;
      continue;
    }
    await ctx.humanDelay();
    const idleFor = Date.now() - ctx.lastPayloadAt();
    if (!findNext() && idleFor >= ctx.idleStopMs && ++idleRounds >= idleRoundsToStop) {
      return finish('Dừng vì không còn trang để tải và không có dữ liệu mới.');
    }
  }
  return finish(`Dừng vì đạt giới hạn an toàn ${MAX_ACTIONS} thao tác.`);
}
