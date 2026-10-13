import { BlockedError } from '@/adapters/errors';
import type { ActionContext, BlockReason } from '@/adapters/types';
import { AbortedError } from '@/shared/utils/delay';
import { runApi } from './api-runner';
import type { CommentPager } from './comment-pager';
import { htmlJsonBlocks } from './html-json';
import type { LoadMoreConfig } from './load-more';

/**
 * Gắn chế độ nhanh (pager + api-runner) vào vòng lặp tải bằng nút (`loadMoreComments`):
 * - khôi phục trạng thái lần trước, đọc lô nhúng trong HTML rồi nghe mọi payload của trang;
 * - mỗi vòng: còn việc API thì chạy hết (gốc tuần tự + reply song song), tải xong thì kết thúc;
 * - nút nào API đã lo thì vòng lặp không bấm nữa (bấm sẽ tải trùng trang API đã lấy).
 */

export interface FastMode {
  /** Các dòng ghi chú về chế độ nhanh (chạy tiếp, kích thước trang, thống kê request). */
  lines(): string[];
  /** Phần cấu hình gắn vào `loadMoreComments`. */
  loop: Pick<LoadMoreConfig, 'allowComments' | 'allowReplies' | 'step'>;
  dispose(): void;
}

export function attachFastMode(
  ctx: ActionContext,
  pager: CommentPager | null,
  opts: {
    /** Khối JSON trong HTML cần đọc (chứa một trong các chuỗi này). */
    htmlMarkers: (string | null)[];
    detectBlock(doc: Document): BlockReason | null;
  },
): FastMode {
  const access = ctx.graphql;
  const resumed = !!(pager && ctx.resume && pager.restore(ctx.resume));
  // Thứ tự quan trọng: lô nhúng trong HTML (cũ nhất) trước, rồi các response trang đã tải.
  if (pager) {
    for (const raw of htmlJsonBlocks(document, opts.htmlMarkers)) {
      pager.observe({ operationName: null, docId: null, variables: null, raw, source: 'page' });
    }
    ctx.checkpoint(() => pager.snapshot());
  }
  const unsubscribe = pager && access ? access.subscribe((p) => pager.observe(p)) : null;
  const lines = () =>
    pager
      ? [
          resumed ? 'Chạy tiếp từ chỗ dừng lần trước.' : null,
          pager.pageSizeLine(),
          pager.describe(),
        ].filter((l): l is string => !!l)
      : [];

  return {
    lines,
    loop: {
      allowComments: () => !pager?.handles('root'),
      allowReplies: () => !pager?.handlesReplies(),
      step: async () => {
        if (!pager || !access?.ready()) return 'idle';
        if (pager.hasWork()) {
          await runApi(pager, access, {
            check: () => {
              if (ctx.signal.aborted) throw new AbortedError();
              const block = opts.detectBlock(document);
              if (block) throw new BlockedError(block);
            },
            log: ctx.log,
            onProgress: () => ctx.report(lines().join('\n')),
          });
          return 'worked';
        }
        return pager.isComplete() ? 'done' : 'idle';
      },
    },
    dispose: () => unsubscribe?.(),
  };
}
