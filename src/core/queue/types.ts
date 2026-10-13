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
  /** Ghi chú khi xong: số lần bấm tải thêm, lý do dừng. */
  note?: string | null;
  /** Lỗi do bị chặn: sẽ chạy lại khi người dùng bấm Tiếp tục. */
  retryOnResume: boolean;
  /** Có trạng thái đã lưu để "Chạy tiếp" thay vì tải lại từ đầu. */
  hasCheckpoint?: boolean;
  /** ISO 8601 của bình luận gốc mới nhất đã lấy (cho chế độ "chỉ lấy bình luận mới"). */
  newestCommentAt?: string | null;
  /** Đã dừng vì đủ số bình luận tối đa (chưa lấy hết bài). */
  limitReached?: boolean;
  startedAt: string | null;
  finishedAt: string | null;
}

export type RunStatus = 'idle' | 'running' | 'paused' | 'blocked' | 'cancelled' | 'completed';

/** Một cửa sổ thu thập (tái sử dụng giữa các bài). Chạy song song = nhiều cửa sổ. */
export interface Worker {
  tabId: number;
  windowId: number;
  /** Vị trí trong lưới cửa sổ khi chạy song song. */
  slot: number;
  /** Bài đang chạy trong cửa sổ này; null = rảnh. */
  itemId: string | null;
  debugSessionId: string | null;
}

/** Vùng màn hình để xếp các cửa sổ thu thập cạnh nhau (lấy từ cửa sổ trình duyệt chính). */
export interface ScreenArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface QueueState {
  status: RunStatus;
  items: QueueItem[];
  workers: Worker[];
  area: ScreenArea | null;
  /** Thời điểm sớm nhất được bắt đầu bài tiếp theo (nghỉ giữa bài / giới hạn mỗi giờ). */
  nextRunAt: number | null;
  /** Lý do đang chờ, hiển thị cho người dùng. */
  waitReason: string | null;
  /** Thông báo khi bị chặn / lỗi toàn cục. */
  message: string | null;
  /** Mốc thời gian (ms) bắt đầu từng bài, để giới hạn số bài mỗi giờ. */
  startHistory: number[];
  /** Thời điểm (ms) bấm chạy danh sách hiện tại. */
  startedAt: number | null;
  /** Thời điểm (ms) danh sách hoàn tất hoặc bị hủy; null khi còn đang chạy/tạm dừng. */
  finishedAt: number | null;
}

export const EMPTY_QUEUE: QueueState = {
  status: 'idle',
  items: [],
  workers: [],
  area: null,
  nextRunAt: null,
  waitReason: null,
  message: null,
  startHistory: [],
  startedAt: null,
  finishedAt: null,
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  pending: 'Chờ',
  running: 'Đang chạy',
  done: 'Xong',
  error: 'Lỗi',
  skipped: 'Bỏ qua',
};
