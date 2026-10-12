import type { Platform } from '@/adapters/types';

export type ItemStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface QueueItem {
  id: string;
  /** Link người dùng nhập (đã trim). */
  inputUrl: string;
  normalizedUrl: string;
  platform: Platform | null;
  status: ItemStatus;
  rootCount: number;
  replyCount: number;
  /** Tổng số bình luận nền tảng hiển thị, để đối chiếu. */
  expectedTotal: number | null;
  error: string | null;
  /** Lỗi do bị chặn: sẽ chạy lại khi người dùng bấm Tiếp tục. */
  retryOnResume: boolean;
  startedAt: string | null;
  finishedAt: string | null;
}

export type RunStatus = 'idle' | 'running' | 'paused' | 'blocked' | 'cancelled' | 'completed';

export interface QueueState {
  status: RunStatus;
  items: QueueItem[];
  currentItemId: string | null;
  /** Tab chuyên dụng dùng để mở bài viết (tái sử dụng giữa các bài). */
  workerTabId: number | null;
  workerWindowId: number | null;
  /** Thời điểm sớm nhất được bắt đầu bài tiếp theo (nghỉ giữa bài / giới hạn mỗi giờ). */
  nextRunAt: number | null;
  /** Lý do đang chờ, hiển thị cho người dùng. */
  waitReason: string | null;
  /** Thông báo khi bị chặn / lỗi toàn cục. */
  message: string | null;
  /** Mốc thời gian (ms) bắt đầu từng bài, để giới hạn số bài mỗi giờ. */
  startHistory: number[];
  currentDebugSessionId: string | null;
}

export const EMPTY_QUEUE: QueueState = {
  status: 'idle',
  items: [],
  currentItemId: null,
  workerTabId: null,
  workerWindowId: null,
  nextRunAt: null,
  waitReason: null,
  message: null,
  startHistory: [],
  currentDebugSessionId: null,
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  pending: 'Chờ',
  running: 'Đang chạy',
  done: 'Xong',
  error: 'Lỗi',
  skipped: 'Bỏ qua',
};
