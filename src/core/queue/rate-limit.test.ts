import { describe, expect, it } from 'vitest';
import { nextAllowedByHourlyLimit, pruneHistory } from './rate-limit';

const H = 3_600_000;

describe('rate limit', () => {
  it('cho chạy ngay khi chưa chạm giới hạn', () => {
    expect(nextAllowedByHourlyLimit([1, 2], 3, 10)).toBe(10);
  });
  it('chờ tới khi mốc cũ nhất hết hạn 1 giờ', () => {
    const now = 10 * H;
    expect(nextAllowedByHourlyLimit([now - 30 * 60_000, now - 10 * 60_000], 2, now)).toBe(
      now - 30 * 60_000 + H,
    );
  });
  it('bỏ mốc cũ hơn 1 giờ', () => {
    expect(pruneHistory([0, H / 2, H + 1], H + 2)).toEqual([H / 2, H + 1]);
  });
});
