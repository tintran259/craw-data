import { describe, expect, it } from 'vitest';
import { fileTimestamp, formatDisplayTime, formatDuration } from './time';

describe('time', () => {
  it('fileTimestamp', () => {
    expect(fileTimestamp(new Date(2026, 0, 5, 7, 8, 9))).toBe('20260105_070809');
  });
  it('formatDisplayTime', () => {
    expect(formatDisplayTime(new Date(2026, 11, 31, 23, 59, 1).toISOString())).toBe(
      '31/12/2026 23:59:01',
    );
    expect(formatDisplayTime(null)).toBe('');
    expect(formatDisplayTime('garbage')).toBe('');
  });
  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0 giây');
    expect(formatDuration(45_900)).toBe('45 giây');
    expect(formatDuration(5 * 60_000 + 3000)).toBe('5 phút 3 giây');
    expect(formatDuration(3600_000 + 3000)).toBe('1 giờ 0 phút 3 giây');
    expect(formatDuration(-5)).toBe('0 giây');
  });
});
