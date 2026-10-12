import { describe, expect, it } from 'vitest';
import { fileTimestamp, formatDisplayTime } from './time';

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
});
