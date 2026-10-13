import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, getSettings, sanitizeSettings, updateSettings } from './settings';

describe('settings', () => {
  beforeEach(() => fakeBrowser.reset());

  it('trả về mặc định khi chưa lưu', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('lưu và đọc lại', async () => {
    await updateSettings({ debugMode: true });
    expect((await getSettings()).debugMode).toBe(true);
  });

  it('đọc cài đặt cũ includeReplies và giới hạn replyDepth', () => {
    expect(sanitizeSettings({ includeReplies: false }).replyDepth).toBe(0);
    expect(sanitizeSettings({ includeReplies: true }).replyDepth).toBe(2);
    expect(sanitizeSettings({ replyDepth: 1 }).replyDepth).toBe(1);
    expect(sanitizeSettings({ replyDepth: 7 as never }).replyDepth).toBe(2);
  });

  it('giới hạn các tùy chọn tốc độ / phạm vi trong khoảng hợp lệ', () => {
    const s = sanitizeSettings({
      replyLanes: 9,
      parallelPosts: 0,
      maxCommentsPerPost: -5,
      apiDelayMs: { min: 0, max: 0 },
    });
    expect(s).toMatchObject({
      replyLanes: 4,
      parallelPosts: 1,
      maxCommentsPerPost: 0,
      apiDelayMs: { min: 300, max: 300 },
    });
  });

  it('không cho phép bỏ qua delay', () => {
    const s = sanitizeSettings({ actionDelayMs: { min: 0, max: 0 }, maxPostsPerHour: 0 });
    expect(s.actionDelayMs.min).toBeGreaterThanOrEqual(500);
    expect(s.maxPostsPerHour).toBe(1);
  });
});
