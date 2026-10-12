import type { BlockReason } from './types';

/** Adapter throw lỗi này khi phát hiện trang bị hạn chế. */
export class BlockedError extends Error {
  constructor(readonly reason: BlockReason) {
    super(reason.message);
    this.name = 'BlockedError';
  }
}
