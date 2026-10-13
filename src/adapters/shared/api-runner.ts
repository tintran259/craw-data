import { BlockedError } from '@/adapters/errors';
import type { BlockReason, GraphqlAccess } from '@/adapters/types';
import type { CommentPager, PlannedRequest } from './comment-pager';

/**
 * Chạy hết việc API đang có: MỘT luồng cho chuỗi bình luận gốc (bắt buộc tuần tự theo cursor) và
 * `access.replyLanes` luồng tải nhánh reply song song. Luồng reply bắt đầu ngay khi trang gốc đầu
 * tiên mang về nhánh reply — tổng thời gian ≈ thời gian của riêng chuỗi gốc.
 * Mỗi luồng tự nghỉ `access.delay()` sau mỗi request.
 */

export const API_RATE_LIMITED: BlockReason = {
  code: 'rate_limited',
  message:
    'Nền tảng báo đang gửi quá nhiều yêu cầu (chế độ nhanh). Đã dừng hàng đợi — hãy nghỉ một thời gian rồi tăng "Trễ giữa request API" hoặc giảm số luồng trong Cài đặt.',
};

/** Nền tảng báo trang rỗng tạm thời: nghỉ lâu hơn bình thường. */
const BACKOFF_MS = 5000;

export interface ApiRunHooks {
  /** Throw nếu bị hủy / bị chặn (gọi trước mỗi request). */
  check(): void;
  log(message: string): void;
  /** Sau mỗi request (cập nhật ghi chú trực tiếp). */
  onProgress(): void;
}

export async function runApi(
  pager: CommentPager,
  access: GraphqlAccess,
  hooks: ApiRunHooks,
): Promise<void> {
  let failure: unknown = null;

  const lane = async (take: () => PlannedRequest | null, mayWait: () => boolean) => {
    while (failure === null) {
      hooks.check();
      const call = take();
      if (!call) {
        if (!mayWait()) return;
        await pager.changed(); // chờ trang gốc / nhánh mới do luồng khác mang về
        continue;
      }
      const res = await access.request(call);
      const outcome = pager.onResult(call, res.status, res.raw);
      hooks.onProgress();
      if (outcome === 'rate_limited') throw new BlockedError(API_RATE_LIMITED);
      if (outcome === 'disabled') hooks.log(`Tắt API cho ${call.kind} — quay về bấm nút.`);
      if (outcome === 'backoff') {
        hooks.log('Trang rỗng tạm thời — nghỉ rồi thử lại.');
        await access.sleep(BACKOFF_MS);
      }
      await access.delay();
    }
  };

  const guarded = (run: () => Promise<void>) =>
    run().catch((err: unknown) => {
      failure ??= err;
      pager.notify(); // đánh thức các luồng đang chờ để chúng thoát
    });

  await Promise.all([
    guarded(() =>
      lane(
        () => pager.takeRoot(),
        () => false,
      ),
    ),
    ...Array.from({ length: Math.max(1, access.replyLanes) }, () =>
      guarded(() =>
        lane(
          () => pager.takeThread(),
          () => pager.mayProduceWork(),
        ),
      ),
    ),
  ]);
  if (failure !== null) throw failure;
}
